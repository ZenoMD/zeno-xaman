import { getXumm } from "./xumm-client";
import type { LogFn, XrplToken } from "./types";

export const AXELAR_GATEWAY = "rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw";
export const DESTINATION_CHAIN = "xrpl-evm";
export const POOL_ROUTER_ADDRESS = "0x43D9c6CD452aC2eCEe7a22a3b659154eDAf1DaFB";

// Links on-chain transactions to this xApp
export const SOURCE_TAG = 2606220004;

// Relayer gas budget, in drops, carved out of each XRP transfer to pay for
// execution on the destination chain (the `gas_fee_amount` memo). The pool
// receives Amount − gas_fee_amount. Tune to whatever the relayer requires.
export const GAS_FEE_DROPS = 100_000; // 0.1 XRP
const XRP_DROPS = 1_000_000;

// ASCII → lowercase hex. XRPL memo fields are hex blobs.
const hex = (s: string): string =>
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

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
  const txjson = buildShieldPayment({ account, token, amount, payload });

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

/**
 * Build the XRPL Payment that bridges `amount` of `token` to the shielded pool
 * on the EVM sidechain via Axelar.
 */
function buildShieldPayment({
  account,
  token,
  amount,
  payload,
}: ShieldArgs): ShieldPayment {
  const isXrp = token.id === "XRP" || !token.issuer;

  let Amount: string | IssuedAmount;
  let gasFee: string;
  if (isXrp) {
    const drops = Math.round(Number(amount) * XRP_DROPS);
    if (drops <= GAS_FEE_DROPS) {
      throw new Error(
        `Amount must exceed the ${GAS_FEE_DROPS / XRP_DROPS} XRP bridge gas fee`,
      );
    }
    Amount = String(drops);
    gasFee = String(GAS_FEE_DROPS);
  } else {
    // Issued currency (IOU): Amount is an object in the on-ledger currency code.
    // The gas fee shares the same denomination (left at 0 here — set per token).
    Amount = {
      currency: token.rawCurrency || token.currency,
      issuer: token.issuer,
      value: String(amount),
    };
    gasFee = "0";
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
