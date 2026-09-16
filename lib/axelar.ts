import { Contract, formatUnits, toUtf8Bytes } from "ethers";
import { getXumm } from "./xumm-client";
import { getMetaProvider } from "./railgun";
import type { LogFn, XrplToken } from "./types";

export const AXELAR_GATEWAY = "rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw";
export const DESTINATION_CHAIN = "xrpl-evm";
export const POOL_ROUTER_ADDRESS = "0x7F8AEC8fcFDbAa9fECcBE4bEf3efF6cD838e2b9d";

// Links on-chain transactions to this xApp
export const SOURCE_TAG = 2606220004;

const XRP_DROPS = 1_000_000;

// Gas is paid ON TOP of the shielded amount (the Payment carries `amount + gas`,
// Axelar deducts the gas_fee_amount memo for relay and forwards the rest, so the
// pool receives exactly `amount`). The fee is always estimated live from Axelar
// (see estimateShieldGas) — there is deliberately no hardcoded fallback, since a
// fixed budget could massively overpay for a high-value token (0.5 WBTC as gas).

// Sum two XRPL decimal-string amounts, trimming binary-float noise to XRPL's
// 15-significant-digit precision (e.g. addDecimal("0.1","0.2") === "0.3").
export const addDecimal = (a: string, b: string): string =>
  String(Number((Number(a) + Number(b)).toPrecision(15)));

// ASCII → lowercase hex. XRPL memo fields are hex blobs.
const hex = (s: string): string =>
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// The router keys its allow list by the raw UTF-8 bytes of the XRPL source
// address (see AxelarPoolRouter.sol's `allowList` mapping / justfile's
// `cast from-utf8`), not an EVM address — there is no dedicated bool-returning
// helper, so we read the public mapping getter directly.
const ALLOW_LIST_ABI = ["function allowList(bytes) view returns (bool)"];

/**
 * Check whether `xrplAddress` is allowed to deposit through the router. Any
 * failure (RPC error, etc.) is deliberately left to propagate rather than
 * defaulting to "allowed" — an unverifiable check must block the deposit, not
 * silently pass it.
 */
export async function isSourceAddressWhitelisted(
  xrplAddress: string,
  networkName: string,
): Promise<boolean> {
  const router = new Contract(
    POOL_ROUTER_ADDRESS,
    ALLOW_LIST_ABI,
    getMetaProvider(networkName),
  );
  return router.allowList(toUtf8Bytes(xrplAddress));
}

type Memo = { Memo: { MemoType: string; MemoData: string } };

const memo = (type: string, data: string): Memo => ({
  Memo: { MemoType: hex(type), MemoData: hex(data) },
});

// The `payload` memo carries the raw payload hex directly (unlike the others,
// whose data is the hex of an ASCII string). Strip any 0x and use it as-is.
const payloadMemo = (payloadHex: string): Memo => ({
  Memo: { MemoType: hex("payload"), MemoData: payloadHex.replace(/^0x/, "") },
});

type IssuedAmount = { currency: string; issuer: string | null; value: string };

export type ShieldPayment = {
  TransactionType: "Payment";
  Account: string;
  Destination: string;
  SourceTag: number;
  Amount: string | IssuedAmount;
  Memos: Memo[];
};

export type ShieldArgs = {
  account: string;
  token: XrplToken;
  amount: string;
  /**
   * 0x ABI-encoded ShieldRequest[] for the router to execute; when present, the
   * bridge calls the router instead of just transferring tokens to it.
   */
  payload?: string;
};

/**
 * Shield by bridging XRPL funds to the EVM-sidechain shielded pool. Builds the
 * Axelar interchain-transfer Payment and has the user sign it in Xaman.
 *
 * @returns the XRPL transaction id
 */
export async function shieldViaAxelar(
  { account, token, amount, payload }: ShieldArgs,
  log: LogFn = console.log,
): Promise<{ txid: string }> {
  const xumm = getXumm();
  const txjson = await buildShieldPayment(
    { account, token, amount, payload },
    log,
  );

  log(
    `Shield: bridging ${amount} ${token.currency} → ${DESTINATION_CHAIN} ` +
      `router ${POOL_ROUTER_ADDRESS.slice(0, 10)}…`,
  );

  const sub = await xumm.payload!.createAndSubscribe(
    {
      txjson,
      custom_meta: {
        instruction: `Shield ${amount} ${token.currency} to the EVM sidechain via Axelar`,
      },
    } as any,
    // The socket emits several messages; `signed` is only on the final outcome.
    (event: any) => {
      if (typeof event.data.signed !== "undefined") return event.data;
    },
  );

  // Open it natively on-device rather than showing a QR.
  await xumm.xapp!.openSignRequest({ uuid: sub.created.uuid });

  const resolved = (await sub.resolved) as any;
  if (!resolved.signed) throw new Error("User declined the shield payment");

  const full = await xumm.payload!.get(sub.created.uuid);
  const txid = full!.response.txid as string;
  log(`Shield payment submitted → ${txid}`);
  return { txid };
}

// --- Axelar gas estimation (GMP API) --------------------------------------

// Axelar's cross-chain gas estimator. It returns the fee already denominated in
// the `sourceTokenSymbol` we pass, so we ask for it in the transferred asset —
// exactly what XRPL's gas_fee_amount memo requires.
const GMP_API = "https://api.gmp.axelarscan.io";

// Destination execution gas for the shield (_executeWithInterchainToken ->
// pool.shield). The Axelar base fee dominates the estimate, so a rough limit is
// fine; keep headroom for the RAILGUN commitment insert.
const SHIELD_GAS_LIMIT = 700_000;

// Buffer Axelar applies to the execution portion of the estimate.
const GAS_MULTIPLIER = 1.5;

// The estimate barely moves between blocks; cache briefly so we don't hit the
// API on every amount keystroke.
const GAS_CACHE_MS = 60_000;
const gasCache = new Map<string, { quote: ShieldGasQuote; at: number }>();

export type ShieldGasQuote = {
  /**
   * The `gas_fee_amount` memo value: integer drops for XRP, a decimal string in
   * the currency's own units for an IOU.
   */
  memoAmount: string;
  /** The same fee as a human amount of the token (XRP rather than drops). */
  human: string;
};

// Map an XRPL token to the symbol Axelar's gas API prices. XRP is native; issued
// currencies use their display code minus any axl prefix/suffix.
const axelarGasSymbol = (token: XrplToken): string =>
  !token.issuer
    ? "XRP"
    : token.currency.replace(/\.axl$/i, "").replace(/^axl/i, "");

/**
 * Estimate the Axelar relay gas for shielding `token`, in both the
 * gas_fee_amount memo denomination and a human amount of the token. THROWS if
 * Axelar can't return a plausible price (it returns 0 for tokens it doesn't
 * price, e.g. WBTC) — there is deliberately no hardcoded fallback, since a fixed
 * budget could massively overpay for a high-value token (0.5 WBTC as gas). A
 * failed estimate aborts the shield rather than guessing.
 *
 * Shared by the shield itself and the fee quote shown while the user types
 * (lib/fees.ts), so the two can never disagree; both hit the same 60s cache.
 */
export async function estimateShieldGas(
  token: XrplToken,
  log: LogFn = console.log,
): Promise<ShieldGasQuote> {
  const isXrp = !token.issuer;
  const symbol = axelarGasSymbol(token);
  const cached = gasCache.get(symbol);
  if (cached && Date.now() - cached.at < GAS_CACHE_MS) return cached.quote;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(GMP_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        method: "estimateGasFee",
        sourceChain: "xrpl",
        destinationChain: DESTINATION_CHAIN,
        sourceTokenSymbol: symbol,
        gasLimit: SHIELD_GAS_LIMIT,
        gasMultiplier: GAS_MULTIPLIER,
        showDetailedFees: true,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      totalFee?: string;
      apiResponse?: { result?: { source_token?: { decimals?: number } } };
    };
    const totalFee = data.totalFee;
    const decimals = data.apiResponse?.result?.source_token?.decimals;
    const units = Number(totalFee);
    if (
      !totalFee ||
      decimals == null ||
      !Number.isFinite(units) ||
      units <= 0
    ) {
      throw new Error(
        `implausible estimate: ${totalFee} (decimals ${decimals})`,
      );
    }
    // totalFee is in the source token's smallest units. XRP's smallest unit IS
    // the drop (the gas_fee_amount denomination); an IOU needs scaling by its
    // decimals into a decimal string.
    const memoAmount = isXrp
      ? String(Math.round(units))
      : formatUnits(BigInt(totalFee), decimals);
    const quote: ShieldGasQuote = {
      memoAmount,
      // The IOU memo is already a human amount; drops are not.
      human: isXrp ? String(Math.round(units) / XRP_DROPS) : memoAmount,
    };
    gasCache.set(symbol, { quote, at: Date.now() });
    log(`Axelar gas estimate (${symbol}): ${memoAmount}`);
    return quote;
  } catch (e) {
    const detail = (e as Error).message;
    log(`Axelar gas estimate failed (${symbol}): ${detail}`);
    throw new Error(
      `Couldn't estimate Axelar bridge gas for ${symbol}; shield aborted (${detail})`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the XRPL Payment that bridges `amount` of `token` to the shielded pool
 * on the EVM sidechain via Axelar.
 */
async function buildShieldPayment(
  { account, token, amount, payload }: ShieldArgs,
  log: LogFn = console.log,
): Promise<ShieldPayment> {
  const isXrp = token.id === "XRP" || !token.issuer;
  if (!(Number(amount) > 0)) {
    throw new Error("Shield amount must be greater than 0");
  }

  // Gas is a SEPARATE amount added on top of the shielded value (not carved out
  // of it), so the pool receives exactly `amount`. The Payment carries
  // `amount + gas`; Axelar deducts the gas_fee_amount memo for relay and
  // forwards the remainder. `estimateShieldGas` returns the fee already in this
  // token's memo denomination (integer drops for XRP, decimal units for an IOU).
  const { memoAmount: gasFee } = await estimateShieldGas(token, log);

  let Amount: string | IssuedAmount;
  if (isXrp) {
    const drops = Math.round(Number(amount) * XRP_DROPS);
    Amount = String(drops + Number(gasFee));
  } else {
    // Issued currency (IOU): Amount is an object in the on-ledger currency code;
    // the gas fee is denominated in that same currency.
    Amount = {
      currency: token.rawCurrency || token.currency,
      issuer: token.issuer,
      value: addDecimal(amount, gasFee),
    };
  }

  // EVM destination address: the canonical raw-bytes hex (the 40-char address
  // without 0x), then hex-encoded again for the memo blob.
  const destination = POOL_ROUTER_ADDRESS.replace(/^0x/, "");

  return {
    TransactionType: "Payment",
    Account: account,
    Destination: AXELAR_GATEWAY,
    SourceTag: SOURCE_TAG,
    Amount,
    Memos: [
      memo("type", "interchain_transfer"),
      memo("destination_address", destination),
      memo("destination_chain", DESTINATION_CHAIN),
      memo("gas_fee_amount", gasFee),
      ...(payload ? [payloadMemo(payload)] : []),
    ],
  };
}
