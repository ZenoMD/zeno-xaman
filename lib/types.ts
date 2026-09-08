// Shared app-level types.

export type LogFn = (msg: string) => void;

/** The three directions the wallet can move funds in; one tab each. */
export type TabId = "shield" | "transfer" | "unshield";

/**
 * Where the shielded-balance sync has got to.
 *
 * A union rather than a phase plus a loose `scanProgress` number: the fraction
 * only means anything while the scan is running, and carrying it inside the
 * `scanning` arm makes "42% and complete" unrepresentable instead of merely
 * unlikely. It also keeps the whole sync state as one value to pass around.
 *
 * - `idle`: wallet not booted yet (loading modules / awaiting sign-in)
 * - `scanning`: merkletree sync in progress; `progress` is 0..1 and never falls
 * - `complete`: balances have been computed, so what is shown is trustworthy
 */
export type ScanState =
  | { phase: "idle" }
  | { phase: "scanning"; progress: number }
  | { phase: "complete" };

/**
 * What the active form tells the header card: the asset in play, and where the
 * funds are headed when that is not the wallet's own account.
 */
export type FlowSelection = {
  /** Display symbol of the selected token; absent while the list loads. */
  symbol?: string;
  /** A valid recipient address entered in the form, if any. */
  destination?: string;
  /** Showing the receive address: nothing is moving, so the card holds one balance. */
  receive?: boolean;
};

/** A spendable asset in the connected XRPL wallet (see fetchXrplTokens). */
export type XrplToken = {
  id: string;
  currency: string;
  issuer: string | null;
  /** On-ledger currency code (present for issued currencies, used for Payments). */
  rawCurrency?: string;
  balance: string;
  label: string;
  // Whether the Axelar bridge can accept this asset for shielding (must hold a TrustLine)
  supported?: boolean;
};

export type XrplTokens = {
  account: string;
  tokens: XrplToken[];
};

/** A shielded (in-pool) balance for the multi-token balance card. */
export type ShieldedTokenBalance = {
  /** ERC20 address on the EVM sidechain (keys the RAILGUN balance). */
  address: string;
  /** Display symbol (XRP for the wrapped-native sentinel). */
  symbol: string;
  /** Human-formatted amount, scaled by the token's own decimals. */
  balance: string;
};

export type ShieldParams = {
  token?: string;
  tokenId: string;
  amount: string;
  /** Optional 0zk recipient; defaults to the connected wallet's own address. */
  recipientAddress?: string;
};

export type TransferParams = {
  recipientAddress: string;
  amount: string;
  /** shielded ERC20 to send (EVM address). */
  tokenAddress: string;
  memoText?: string;
};

export type UnshieldParams = {
  amount: string;
  /** shielded ERC20 to unshield (EVM address). */
  tokenAddress: string;
  /** Optional destination XRPL r-address; defaults to the connected account. */
  xrplRecipient?: string;
};

/** One priced cost inside a FeeQuote, in its own denomination. */
export type FeeLine = {
  /** What the cost is, e.g. "Axelar bridge gas". */
  label: string;
  /** Human-formatted magnitude, always positive. */
  amount: string;
  /**
   * This line's denomination, which is not always the quote's `symbol` — the
   * unshield's return relay gas is native XRP whatever token is moving.
   */
  symbol: string;
  /**
   * `added`: charged on top, so the source pays `amount + this`.
   * `deducted`: taken out of the amount in flight, so less arrives.
   */
  kind: "added" | "deducted";
};

/**
 * The full cost of moving `amount` through one flow, ending in what the
 * destination actually receives. Produced by `WalletApi.quoteFees` and safe to
 * request on every keystroke (see lib/fees.ts for the caching).
 */
export type FeeQuote = {
  flow: TabId;
  /** The amount quoted, echoed back. */
  amount: string;
  /** Denomination of `amount`, `sends` and `receives`. */
  symbol: string;
  /** Every cost found, in the order the money meets them. */
  lines: FeeLine[];
  /** Total leaving the source: `amount` plus every `added` line in `symbol`. */
  sends: string;
  /** What lands at the destination: `amount` minus every `deducted` line. */
  receives: string;
  /**
   * Set when a component could not be priced (no broadcaster online, Axelar
   * won't price the token, an RPC read failed). `sends` and `receives` then
   * simply omit that cost, so both are optimistic — show this message rather
   * than presenting them as the final numbers.
   */
  incomplete?: string;
};

/** What to quote: mirrors the params of the matching WalletApi action. */
export type FeeQuoteParams =
  | { flow: "shield"; tokenId: string; amount: string }
  | { flow: "transfer"; tokenAddress: string; amount: string }
  | { flow: "unshield"; tokenAddress: string; amount: string };

/** The wallet controller returned by startWallet() and consumed by the UI. */
export type WalletApi = {
  railgunAddress: string;
  network: string;
  getXrplTokens: () => Promise<XrplTokens>;
  /** Shielded (in-pool) balances available to transfer, as pickable tokens. */
  getShieldedTokens: () => Promise<XrplToken[]>;
  shield: (params: ShieldParams) => Promise<{ txid: string }>;
  transfer: (params: TransferParams) => Promise<{ txHash: string }>;
  /** Unshield a pool balance back to XRPL via RelayAdapt + Axelar ITS. */
  unshield: (params: UnshieldParams) => Promise<{ txHash: string }>;
  /**
   * Price a flow: every fee between the entered amount and what the destination
   * receives. Cached and single-flighted, so it is safe to call as the user
   * types; it only throws when there is no quote at all (unknown token, amount
   * not a positive number). A partial quote comes back with `incomplete` set.
   */
  quoteFees: (params: FeeQuoteParams) => Promise<FeeQuote>;
  /** Open an external URL in the device browser via the Xaman xApp SDK. */
  openBrowser: (url: string) => void;
  stop: () => void;
};
