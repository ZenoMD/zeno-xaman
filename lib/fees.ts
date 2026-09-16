import {
  NETWORK_CONFIG,
  type NetworkName,
} from "@railgun-community/shared-models";
import { formatUnits, parseUnits } from "ethers";
import { addDecimal, estimateShieldGas } from "./axelar";
import { prepareTransfer, prepareUnshield } from "./broadcaster";
import { getPoolFeeBasisPoints } from "./pool-fees";
import { resolveTokenMeta, WETH_ADDRESS } from "./railgun";
import type {
  FeeLine,
  FeeQuote,
  FeeQuoteParams,
  LogFn,
  XrplToken,
} from "./types";

// Prices what a flow costs between the amount the user types and what the
// destination receives. Every number here comes from the same call the real
// transaction makes — the live Axelar GMP estimate, the pool's own fee getters,
// the broadcaster's Waku fee message — so a quote and its transaction can never
// disagree. Nothing is invented: a cost that cannot be read is reported as a gap
// in `incomplete` rather than filled in with a plausible-looking number.

/** Everything a quote needs that the form doesn't supply. */
export type FeeQuoteContext = {
  networkName: NetworkName;
  railgunWalletID: string;
  encryptionKey: string;
  /** This wallet's own 0zk address, used as the placeholder transfer recipient. */
  railgunAddress: string;
  /** The XRPL token a shield names, from the wallet's (cached) token list. */
  resolveXrplToken: (tokenId: string) => Promise<XrplToken>;
  /** The connected XRPL account, the default unshield destination. */
  getXrplAccount: () => Promise<string>;
  /** Quote progress. Defaults to silent: this runs on every keystroke. */
  log?: LogFn;
};

// A quote is repriced at most once a minute per (flow, token, amount). A quote
// that came back incomplete expires much sooner, so the broadcaster fee lands as
// soon as its Waku fee message arrives instead of being missing for a minute.
const QUOTE_TTL_MS = 60_000;
const INCOMPLETE_TTL_MS = 5_000;

// Typing digit by digit mints a new cache key per keystroke; bound the map.
const MAX_CACHE_ENTRIES = 32;

// How long a quote waits for a broadcaster fee message. Still far short of the
// submission's 45s, since an unpriced line beats a form that sits still, but
// long enough to cover a cold Waku start: measured against
// broadcaster-nwaku.fly.dev, the first fee message arrived 4.8s, 5.3s and 6.3s
// after `start()` resolved, so the old 4s budget missed all three. A quote made
// between the broadcaster's ~15.6s republishes still comes back incomplete; the
// form re-prices it rather than waiting that out inline.
const QUOTE_BROADCASTER_WAIT_MS = 8000;

const cache = new Map<string, { quote: FeeQuote; at: number; ttl: number }>();
const inFlight = new Map<string, Promise<FeeQuote>>();

/**
 * Price `params`, reusing a recent identical quote. Concurrent calls for the
 * same key share one computation, so a debounced form can call this freely.
 * Throws only when there is nothing to quote at all (amount not a positive
 * number, unknown token); anything unpriceable comes back in `incomplete`.
 */
export async function quoteFees(
  ctx: FeeQuoteContext,
  params: FeeQuoteParams,
): Promise<FeeQuote> {
  if (!(Number(params.amount) > 0)) {
    throw new Error("Amount must be greater than 0");
  }

  const key = cacheKey(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.quote;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = computeQuote(ctx, params)
    .then((quote) => {
      remember(key, quote);
      return quote;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

const cacheKey = (params: FeeQuoteParams): string =>
  params.flow === "shield"
    ? `shield|${params.tokenId}|${params.amount}`
    : `${params.flow}|${params.tokenAddress}|${params.amount}`;

function remember(key: string, quote: FeeQuote): void {
  cache.set(key, {
    quote,
    at: Date.now(),
    ttl: quote.incomplete ? INCOMPLETE_TTL_MS : QUOTE_TTL_MS,
  });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

function computeQuote(
  ctx: FeeQuoteContext,
  params: FeeQuoteParams,
): Promise<FeeQuote> {
  switch (params.flow) {
    case "shield":
      return quoteShield(ctx, params.tokenId, params.amount);
    case "transfer":
      return quoteTransfer(ctx, params.tokenAddress, params.amount);
    case "unshield":
      return quoteUnshield(ctx, params.tokenAddress, params.amount);
  }
}

// --- Shield -----------------------------------------------------------------

/**
 * Shield: the XRPL Payment carries `amount + Axelar relay gas`, Axelar deducts
 * the gas and delivers `amount` to the router, and the pool takes its shield fee
 * out of what it is handed. So the shielded balance grows by `amount - fee`
 * while the XRPL account loses `amount + gas`.
 */
async function quoteShield(
  ctx: FeeQuoteContext,
  tokenId: string,
  amount: string,
): Promise<FeeQuote> {
  const token = await ctx.resolveXrplToken(tokenId);
  const symbol = token.currency;
  const lines: FeeLine[] = [];
  const gaps: string[] = [];

  // Charged on top, live from the Axelar GMP API and denominated in the token
  // being bridged (the same estimate, and the same 60s cache, the shield uses).
  let sends = amount;
  try {
    const { human } = await estimateShieldGas(token, ctx.log);
    lines.push({
      label: "Axelar bridge gas",
      amount: human,
      symbol,
      kind: "added",
    });
    sends = addDecimal(amount, human);
  } catch (e) {
    gaps.push(`Axelar bridge gas could not be estimated (${reason(e)})`);
  }

  // Deducted by the pool from what the router shields, so less arrives.
  let receives = amount;
  try {
    const { shield } = await getPoolFeeBasisPoints(ctx.networkName);
    const fee = applyBasisPoints(amount, shield);
    lines.push({
      label: `RAILGUN shield fee (${percent(shield)})`,
      amount: fee,
      symbol,
      kind: "deducted",
    });
    receives = subtractDecimal(amount, fee);
  } catch (e) {
    gaps.push(`RAILGUN shield fee could not be read (${reason(e)})`);
  }

  return {
    flow: "shield",
    amount,
    symbol,
    lines,
    sends,
    receives,
    ...gap(gaps),
  };
}

// --- Transfer ---------------------------------------------------------------

/**
 * Private transfer: the recipient receives the full amount. The broadcaster's
 * fee is a separate shielded output in the same token, so it comes out of the
 * sender's balance on top of what is sent. The pool charges nothing to move
 * funds inside it.
 */
async function quoteTransfer(
  ctx: FeeQuoteContext,
  tokenAddress: string,
  amount: string,
): Promise<FeeQuote> {
  const { symbol, decimals } = await resolveTokenMeta(
    tokenAddress,
    ctx.networkName,
  );
  const value = toBaseUnits(amount, decimals);
  const lines: FeeLine[] = [];
  const gaps: string[] = [];

  let sends = value;
  try {
    // The recipient does not change the gas, so quoting against our own address
    // prices a transfer the form has no recipient for yet.
    const { totalFee } = await prepareTransfer(
      {
        networkName: ctx.networkName,
        railgunWalletID: ctx.railgunWalletID,
        encryptionKey: ctx.encryptionKey,
        recipientAddress: ctx.railgunAddress,
        tokenAddress,
        amount: value,
        broadcasterWaitMs: QUOTE_BROADCASTER_WAIT_MS,
      },
      ctx.log,
    );
    lines.push({
      label: "Broadcaster fee",
      amount: format(totalFee, decimals),
      symbol,
      kind: "added",
    });
    sends = value + totalFee;
  } catch (e) {
    gaps.push(`Broadcaster fee could not be quoted (${reason(e)})`);
  }

  return {
    flow: "transfer",
    amount,
    symbol,
    lines,
    sends: format(sends, decimals),
    receives: format(value, decimals),
    ...gap(gaps),
  };
}

// --- Unshield ---------------------------------------------------------------

/**
 * Unshield: the pool deducts its unshield fee, the RelayAdapt bridges what is
 * left back to XRPL, and the broadcaster is paid — in the unshielded token — for
 * both the EVM gas and the native XRP it fronts as the Axelar return relay gas.
 */
async function quoteUnshield(
  ctx: FeeQuoteContext,
  tokenAddress: string,
  amount: string,
): Promise<FeeQuote> {
  const { symbol, decimals } = await resolveTokenMeta(
    tokenAddress,
    ctx.networkName,
  );
  const value = toBaseUnits(amount, decimals);

  // The return leg names the asset by the XRP interchain tokenId (lib/its.ts),
  // so only XRP can be bridged back today. Say so rather than pricing a bridge
  // that would revert, and spend no network calls doing it.
  if (!isNativeXrp(tokenAddress, ctx.networkName)) {
    return {
      flow: "unshield",
      amount,
      symbol,
      lines: [],
      sends: amount,
      receives: amount,
      incomplete: `Unshield bridges XRP only — ${symbol} has no return route yet, so its cost is unknown.`,
    };
  }

  const lines: FeeLine[] = [];
  const gaps: string[] = [];
  let sends = value;
  let receives = value;

  try {
    const { unshieldFee, bridgeAmount, gasFee, returnGasValue, totalFee } =
      await prepareUnshield(
        {
          networkName: ctx.networkName,
          railgunWalletID: ctx.railgunWalletID,
          encryptionKey: ctx.encryptionKey,
          xrplRecipient: await ctx.getXrplAccount(),
          tokenAddress,
          amount: value,
          broadcasterWaitMs: QUOTE_BROADCASTER_WAIT_MS,
        },
        ctx.log,
      );
    const { unshield } = await getPoolFeeBasisPoints(ctx.networkName);

    lines.push({
      label: `RAILGUN unshield fee (${percent(unshield)})`,
      amount: format(unshieldFee, decimals),
      symbol,
      kind: "deducted",
    });
    lines.push({
      label: "Broadcaster fee",
      amount: format(gasFee, decimals),
      symbol,
      kind: "added",
    });
    // Native XRP the broadcaster forwards into the ITS call and is reimbursed
    // for in the fee token. Here the fee token IS XRP, so it converts 1:1.
    lines.push({
      label: "Axelar return relay gas",
      amount: format(returnGasValue, 18),
      symbol: "XRP",
      kind: "added",
    });

    receives = bridgeAmount;
    sends = value + totalFee;
  } catch (e) {
    gaps.push(`Unshield cost could not be quoted (${reason(e)})`);
  }

  return {
    flow: "unshield",
    amount,
    symbol,
    lines,
    sends: format(sends, decimals),
    receives: format(receives, decimals),
    ...gap(gaps),
  };
}

// --- Helpers ----------------------------------------------------------------

const gap = (gaps: string[]): { incomplete?: string } =>
  gaps.length ? { incomplete: gaps.join("; ") } : {};

const reason = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Basis points as a percentage label, e.g. 10n -> "0.1%". */
const percent = (basisPoints: bigint): string =>
  `${Number(basisPoints) / 100}%`;

// XRPL decimal-string arithmetic, trimmed to XRPL's 15 significant digits — the
// same treatment lib/axelar.ts gives the amounts it puts on the ledger.
const precise = (n: number): string => String(Number(n.toPrecision(15)));

const subtractDecimal = (a: string, b: string): string =>
  precise(Number(a) - Number(b));

const applyBasisPoints = (amount: string, basisPoints: bigint): string =>
  precise((Number(amount) * Number(basisPoints)) / 10000);

function toBaseUnits(amount: string, decimals: number): bigint {
  try {
    return parseUnits(amount, decimals);
  } catch {
    throw new Error(`"${amount}" is not a valid amount`);
  }
}

/**
 * Base units as a human amount: 6 dp for anything that reads at that scale, and
 * the exact value for dust that would otherwise round to a misleading zero.
 */
function format(value: bigint, decimals: number): string {
  const exact = formatUnits(value, decimals);
  const rounded = Number(Number(exact).toFixed(6));
  return rounded === 0 && value !== 0n ? exact : String(rounded);
}

const isNativeXrp = (
  tokenAddress: string,
  networkName: NetworkName,
): boolean => {
  const key = tokenAddress.toLowerCase();
  const wrapped = (
    NETWORK_CONFIG as Record<
      string,
      { baseToken?: { wrappedAddress?: string } }
    >
  )[networkName]?.baseToken?.wrappedAddress?.toLowerCase();
  return key === WETH_ADDRESS[networkName]?.toLowerCase() || key === wrapped;
};
