// Token display helpers shared by the wallet controller and the UI. Deliberately
// dependency-free: components import this, and pulling in lib/wallet.ts (or the
// RAILGUN engine behind it) would drag the whole wallet stack into the initial
// page bundle.

/** Format a decimal amount string for display: up to 6 dp, trailing zeros trimmed. */
export const trimAmount = (v: string): string => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toFixed(6))) : v;
};

/**
 * Reduce a symbol to the asset it names, so the same asset can be matched across
 * the ledger and the sidechain: an XRPL currency code (`USDC`) and the bridged
 * ERC20 it shields into (`axlUSDC`) are one asset. Mirrors the normalization
 * `axelarGasSymbol` applies before pricing a bridge (lib/axelar.ts).
 */
export const assetKey = (symbol: string): string => {
  const stripped = symbol.replace(/^axl/i, "").replace(/\.axl$/i, "");
  // `AXL` is Axelar's own token, not a bridged anything — keep it whole.
  return (stripped || symbol).toUpperCase();
};

/**
 * Picker order: XRP first — it is the native asset, the one the bridge always
 * accepts, and the one most accounts hold — then by balance, highest first.
 */
export function compareForPicker(
  a: { symbol: string; balance: string },
  b: { symbol: string; balance: string },
): number {
  const aXrp = assetKey(a.symbol) === "XRP";
  const bXrp = assetKey(b.symbol) === "XRP";
  if (aXrp !== bXrp) return aXrp ? -1 : 1;
  return Number(b.balance) - Number(a.balance);
}
