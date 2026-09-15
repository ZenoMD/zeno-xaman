"use client";

import { useCallback, useEffect, useState } from "react";
import { useAssetList, type AssetListState } from "../lib/use-asset-list";
import type {
  FeeQuote,
  FlowSelection,
  ShieldParams,
  TabId,
  TransferLaunchParams,
  WalletApi,
  XrplToken,
} from "../lib/types";
import ChevronIcon from "./icons/chevron-down.svg";

// One-tap amounts, alongside MAX. The balance itself is no longer printed here:
// the header card already shows the side being spent from.
const AMOUNT_PRESETS = ["0.1", "1", "10"];

const TABS: { id: TabId; label: string }[] = [
  { id: "shield", label: "Shield" },
  { id: "transfer", label: "Transfer" },
  { id: "unshield", label: "Unshield" },
];

type Result =
  { ok: true; txid?: string } | { ok: false; message: string } | null;

// Shield/unshield are Axelar GMP transfers; their source tx (XRPL hash for
// shield, EVM relay() hash for unshield) resolves on Axelarscan's GMP explorer.
const axelarscanGmpUrl = (txid: string): string =>
  `https://axelarscan.io/gmp/${txid}`;

export type WalletTabsProps = {
  api: WalletApi;
  /** Controlled by the page, which shows the same direction in the header card. */
  tab: TabId;
  onTabChange: (tab: TabId) => void;
  /** The public (XRPL) asset list, loaded once by the page and shared with the card. */
  publicAssets: AssetListState;
  /** Reports the active form's asset + destination up to the header card. */
  onFlow: (flow: FlowSelection) => void;
  /** Pre-fills the Transfer tab from a payment request the xApp launched with. */
  transferPrefill?: TransferLaunchParams;
};

export function WalletTabs({
  api,
  tab,
  onTabChange,
  publicAssets,
  onFlow,
  transferPrefill,
}: WalletTabsProps) {
  return (
    <div className="tabs">
      <div className="tabs__bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tabs__tab${tab === t.id ? " tabs__tab--active" : ""}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tabs__panel" role="tabpanel">
        {tab === "shield" && (
          <ShieldPanel api={api} publicAssets={publicAssets} onFlow={onFlow} />
        )}
        {tab === "transfer" && (
          <TransferPanel api={api} onFlow={onFlow} prefill={transferPrefill} />
        )}
        {tab === "unshield" && <UnshieldPanel api={api} onFlow={onFlow} />}
      </div>
    </div>
  );
}

function ShieldPanel({
  api,
  publicAssets: { loading, tokens, error },
  onFlow,
}: {
  api: WalletApi;
  publicAssets: AssetListState;
  onFlow: (flow: FlowSelection) => void;
}) {
  const onQuote = useCallback(
    (tokenId: string, amount: string) =>
      api.quoteFees({ flow: "shield", tokenId, amount }),
    [api],
  );
  return (
    <AssetForm
      loading={loading}
      error={error}
      tokens={tokens}
      emptyHint="No tokens found in your XRPL wallet."
      action="Shield"
      busyLabel="Shielding…"
      recipientMode="optional"
      onFlow={onFlow}
      onQuote={onQuote}
      receivesLabel="Arrives shielded"
      onExplorer={(txid) => api.openBrowser(axelarscanGmpUrl(txid))}
      onSubmit={api.shield}
    />
  );
}

// Private transfer: send a shielded balance to another 0zk address. Funds stay
// in the pool (the broadcaster pays EVM gas). Receiving is not a direction of
// travel, so it is not a mode here: the address to be paid at sits on the header
// card, next to the balance that arrives at it.
function TransferPanel({
  api,
  onFlow,
  prefill,
}: {
  api: WalletApi;
  onFlow: (flow: FlowSelection) => void;
  /** Pre-fills token/amount/recipient from a payment request the xApp launched with. */
  prefill?: TransferLaunchParams;
}) {
  const { loading, tokens, error } = useAssetList(
    () => api.getShieldedTokens(),
    [api],
  );
  const onQuote = useCallback(
    (tokenAddress: string, amount: string) =>
      api.quoteFees({ flow: "transfer", tokenAddress, amount }),
    [api],
  );

  return (
    <AssetForm
      loading={loading}
      error={error}
      tokens={tokens}
      emptyHint="No shielded balance yet. Shield some funds first."
      action="Transfer"
      busyLabel="Proving & sending…"
      recipientMode="required"
      recipientHint="Recipient's 0zk address · stays private in the pool"
      onFlow={onFlow}
      onQuote={onQuote}
      receivesLabel="Recipient receives"
      initialTokenId={prefill?.tokenAddress}
      initialAmount={prefill?.amount}
      initialRecipient={prefill?.recipientAddress}
      onSubmit={async ({ tokenId, amount, recipientAddress }) => {
        const res = await api.transfer({
          tokenAddress: tokenId,
          amount,
          recipientAddress: recipientAddress!,
        });
        return { txid: res.txHash };
      }}
    />
  );
}

// Unshield: withdraw a shielded balance back to XRPL. Pick which shielded token
// and amount; it unshields via RelayAdapt and bridges back to XRPL via Axelar.
// Defaults to the connected account, with an option to send to another XRPL
// address.
function UnshieldPanel({
  api,
  onFlow,
}: {
  api: WalletApi;
  onFlow: (flow: FlowSelection) => void;
}) {
  const { loading, tokens, error } = useAssetList(
    () => api.getShieldedTokens(),
    [api],
  );
  const onQuote = useCallback(
    (tokenAddress: string, amount: string) =>
      api.quoteFees({ flow: "unshield", tokenAddress, amount }),
    [api],
  );
  return (
    <AssetForm
      loading={loading}
      error={error}
      tokens={tokens}
      emptyHint="No shielded balance yet. Shield some funds first."
      action="Unshield"
      busyLabel="Proving & sending…"
      recipientMode="optional"
      recipientKind="xrpl"
      recipientLabel="Unshield to another XRPL account"
      recipientHint="Recipient's XRPL address. Leave off to send to your own account."
      onFlow={onFlow}
      onQuote={onQuote}
      receivesLabel="Arrives on XRPL"
      onExplorer={(txid) => api.openBrowser(axelarscanGmpUrl(txid))}
      onSubmit={async ({ tokenId, amount, recipientAddress }) => {
        const res = await api.unshield({
          tokenAddress: tokenId,
          amount,
          xrplRecipient: recipientAddress,
        });
        return { txid: res.txHash };
      }}
    />
  );
}

// What the amount actually costs, ending in what the far end receives. A line's
// own `symbol` is printed because it need not match the quote's: the unshield's
// return relay is paid in native XRP whatever token is moving.
function FeeBreakdown({
  quote,
  receivesLabel,
}: {
  quote: FeeQuote | null;
  receivesLabel: string;
}) {
  if (!quote) return <p className="fees__pending">Calculating fees…</p>;

  return (
    <div className="fees">
      {quote.lines.map((line) => (
        <div key={line.label} className="fees__line">
          <span className="fees__label">{line.label}</span>
          <span className="fees__amount">
            {line.kind === "added" ? "+" : "−"}
            {line.amount} {line.symbol}
          </span>
        </div>
      ))}

      {quote.sends !== quote.amount && (
        <div className="fees__line fees__line--sum">
          <span className="fees__label">Leaves your wallet</span>
          <span className="fees__amount">
            {quote.sends} {quote.symbol}
          </span>
        </div>
      )}

      <div className="fees__line fees__line--sum fees__line--total">
        <span className="fees__label">{receivesLabel}</span>
        <span className="fees__amount">
          {quote.receives} {quote.symbol}
        </span>
      </div>

      {quote.incomplete && <p className="fees__warning">{quote.incomplete}</p>}
    </div>
  );
}

type AssetFormProps = {
  loading: boolean;
  error: string | null;
  tokens: XrplToken[];
  emptyHint: string;
  action: string;
  busyLabel: string;
  /**
   * Recipient field: `optional` shows a checkbox (defaults to self, used by
   * Shield/Unshield), `required` always shows the input and blocks submit until
   * valid (used by Transfer). Omitted = no recipient field.
   */
  recipientMode?: "optional" | "required";
  /** Address kind the recipient field accepts — controls validation + placeholder. */
  recipientKind?: "0zk" | "xrpl";
  /** Text for the optional-recipient checkbox / required-recipient field label. */
  recipientLabel?: string;
  recipientHint?: string;
  /** Pre-fill the token/amount/recipient fields, e.g. from a payment request. */
  initialTokenId?: string;
  initialAmount?: string;
  initialRecipient?: string;
  /** Reports the selected asset + any explicit destination to the header card. */
  onFlow: (flow: FlowSelection) => void;
  /**
   * Prices the entered amount. Must be referentially stable (useCallback on the
   * panel), since it keys the debounced quote effect.
   */
  onQuote: (tokenId: string, amount: string) => Promise<FeeQuote>;
  /** Names the far end of this flow in the fee breakdown, e.g. "Arrives shielded". */
  receivesLabel: string;
  /** Opens an explorer for a successful txid (via the xApp browser); shown as a link. */
  onExplorer?: (txid: string) => void;
  onSubmit: (params: ShieldParams) => Promise<{ txid: string }>;
};

// Shared token + amount form (amount card on top, recipient underneath).
// `onSubmit` receives { token, tokenId, amount, recipientAddress? } and resolves
// to { txid }. `recipientMode` controls whether/how a 0zk recipient is offered.
function AssetForm({
  loading,
  error,
  tokens,
  emptyHint,
  action,
  busyLabel,
  recipientMode,
  recipientKind = "0zk",
  recipientLabel,
  recipientHint,
  initialTokenId,
  initialAmount,
  initialRecipient,
  onFlow,
  onQuote,
  receivesLabel,
  onExplorer,
  onSubmit,
}: AssetFormProps) {
  const [tokenId, setTokenId] = useState(initialTokenId ?? "");
  const [amount, setAmount] = useState(initialAmount ?? "");
  const [useAltRecipient, setUseAltRecipient] = useState(
    Boolean(initialRecipient),
  );
  const [recipient, setRecipient] = useState(initialRecipient ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [quote, setQuote] = useState<FeeQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);

  // Default-select the first selectable token once the list loads. Skip tokens
  // the Axelar bridge can't accept (supported === false) so the form never
  // opens on an unshieldable asset.
  useEffect(() => {
    const selectable = tokens.filter((t) => t.supported !== false);
    if (selectable.length && !selectable.some((t) => t.id === tokenId))
      setTokenId(selectable[0].id);
  }, [tokens, tokenId]);

  const selected = tokens.find((t) => t.id === tokenId);
  const recipientValid =
    recipientKind === "xrpl"
      ? recipient.startsWith("r") &&
        recipient.length >= 25 &&
        recipient.length <= 35
      : recipient.startsWith("0zk") && recipient.length > 10;
  const needRecipient =
    recipientMode === "required" ||
    (recipientMode === "optional" && useAltRecipient);
  const recipientOk = !needRecipient || recipientValid;
  // Only a complete address is worth showing in the header card, so a half-typed
  // one leaves the destination pane on the wallet's own balance.
  const destination =
    needRecipient && recipientValid ? recipient.trim() : undefined;
  const symbol = selected?.currency;

  // Tell the header card which asset is in play, so it can show that asset's
  // balance on both sides of the move this tab makes.
  useEffect(() => {
    onFlow({ symbol, destination });
  }, [onFlow, symbol, destination]);

  // Price the amount once the user pauses. The quote carries the amount it was
  // made for, so a stale one is simply not rendered — no half-typed number ever
  // gets priced as if it were final.
  useEffect(() => {
    if (!tokenId || !(Number(amount) > 0)) return;
    let active = true;
    setQuoteFailed(false);
    const timer = setTimeout(() => {
      onQuote(tokenId, amount)
        .then((q) => active && setQuote(q))
        .catch(() => {
          // No quote at all (rather than a partial one). Drop the breakdown
          // instead of leaving "Calculating fees…" up forever.
          if (!active) return;
          setQuote(null);
          setQuoteFailed(true);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [onQuote, tokenId, amount]);

  if (error) return <p className="panel__hint panel__hint--error">{error}</p>;
  // While loading, keep the card on screen (with an empty token list) rather
  // than swapping it for a hint — the empty-state hint only shows once the load
  // has finished and genuinely returned nothing.
  if (!loading && !tokens.length)
    return <p className="panel__hint">{emptyHint}</p>;

  const amountOk =
    Number(amount) > 0 && Number(amount) <= Number(selected?.balance ?? 0);
  const recipientPlaceholder = recipientKind === "xrpl" ? "r…" : "0zk…";
  const canSubmit =
    Boolean(selected) &&
    selected?.supported !== false &&
    amountOk &&
    recipientOk &&
    !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selected) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await onSubmit({
        token: selected.currency,
        tokenId: selected.id,
        amount,
        recipientAddress: needRecipient ? recipient.trim() : undefined,
      });
      setResult({ ok: true, txid: res?.txid });
      setAmount("");
    } catch (err: unknown) {
      setResult({ ok: false, message: (err as Error).message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <div className="asset-card">
        <div className="asset-card__top">
          <span className="asset-card__label">{action}</span>
          <div className="asset-card__token">
            <select
              className="asset-card__select"
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              aria-label="Token"
              disabled={loading && !tokens.length}
            >
              {loading && !tokens.length ? (
                <option value="">Loading…</option>
              ) : (
                tokens.map((t) => (
                  <option
                    key={t.id}
                    value={t.id}
                    disabled={t.supported === false}
                  >
                    {t.label}
                    {t.supported === false ? " — unsupported" : ""}
                  </option>
                ))
              )}
            </select>
            <span className="asset-card__token-name">
              {selected?.currency ?? (loading ? "…" : "—")}
            </span>
            <ChevronIcon
              className="asset-card__chevron"
              width={18}
              height={18}
            />
          </div>
        </div>

        <div className="asset-card__bottom">
          <input
            className="asset-card__amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
          {selected && (
            <div className="asset-card__quick">
              {AMOUNT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`asset-card__preset${
                    amount === preset ? " asset-card__preset--active" : ""
                  }`}
                  disabled={Number(preset) > Number(selected.balance)}
                  onClick={() => setAmount(preset)}
                >
                  {preset}
                </button>
              ))}
              <button
                type="button"
                className="asset-card__max"
                onClick={() => setAmount(selected.balance)}
              >
                MAX
              </button>
            </div>
          )}
        </div>
      </div>

      {Number(amount) > 0 && !quoteFailed && (
        <FeeBreakdown
          quote={quote?.amount === amount ? quote : null}
          receivesLabel={receivesLabel}
        />
      )}

      {recipientMode === "optional" && (
        <label className="field">
          <span className="field__label field__label--inline">
            <input
              type="checkbox"
              checked={useAltRecipient}
              onChange={(e) => setUseAltRecipient(e.target.checked)}
            />
            {recipientLabel ?? "Shield to another 0zk account"}
          </span>
          {useAltRecipient && (
            <>
              <input
                className="field__input"
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={recipientPlaceholder}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <span className="field__hint">
                {recipientHint ??
                  "Recipient's 0zk address. Leave off to shield to yourself."}
              </span>
            </>
          )}
        </label>
      )}

      {recipientMode === "required" && (
        <label className="field">
          <span className="field__label">
            {recipientLabel ?? "Recipient (0zk address)"}
          </span>
          <input
            className="field__input"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={recipientPlaceholder}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {recipientHint && (
            <span className="field__hint">{recipientHint}</span>
          )}
        </label>
      )}

      <button type="submit" className="btn" disabled={!canSubmit}>
        {busy ? busyLabel : action}
      </button>

      {result && (
        <p
          className={`panel__result${result.ok ? "" : " panel__result--error"}`}
        >
          {result.ok ? (
            <>
              ✓ {action} submitted
              {result.txid &&
                (onExplorer ? (
                  <>
                    {" — "}
                    <button
                      type="button"
                      className="panel__result-link"
                      onClick={() => onExplorer(result.txid!)}
                    >
                      track on Axelarscan ↗
                    </button>
                  </>
                ) : (
                  ` — ${result.txid.slice(0, 14)}…`
                ))}
            </>
          ) : (
            `✕ ${result.message}`
          )}
        </p>
      )}
    </form>
  );
}
