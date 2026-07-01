// Shared app-level types.

export type LogFn = (msg: string) => void;

/** A spendable asset in the connected XRPL wallet (see fetchXrplTokens). */
export type XrplToken = {
  id: string;
  currency: string;
  issuer: string | null;
  /** On-ledger currency code (present for issued currencies, used for Payments). */
  rawCurrency?: string;
  balance: string;
  label: string;
};

export type XrplTokens = {
  account: string;
  tokens: XrplToken[];
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

/** The wallet controller returned by startWallet() and consumed by the UI. */
export type WalletApi = {
  railgunAddress: string;
  network: string;
  getXrplTokens: () => Promise<XrplTokens>;
  /** Shielded (in-pool) balances available to transfer, as pickable tokens. */
  getShieldedTokens: () => Promise<XrplToken[]>;
  shield: (params: ShieldParams) => Promise<{ txid: string }>;
  transfer: (params: TransferParams) => Promise<{ txHash: string }>;
  stop: () => void;
};
