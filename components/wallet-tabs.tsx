"use client";

import { useEffect, useState } from "react";
import type {
  ShieldParams,
  WalletApi,
  XrplToken,
  XrplTokens,
} from "../lib/types";
import ChevronIcon from "./icons/chevron-down.svg";

type TabId = "shield" | "transfer" | "unshield";

const TABS: { id: TabId; label: string }[] = [
  { id: "shield", label: "Shield" },
  { id: "transfer", label: "Transfer" },
  { id: "unshield", label: "Unshield" },
];

type Result =
  { ok: true; txid?: string } | { ok: false; message: string } | null;

export function WalletTabs({ api }: { api: WalletApi }) {
  const [tab, setTab] = useState<TabId>("shield");

  return (
    <div className="tabs">
      <div className="tabs__bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tabs__tab${tab === t.id ? " tabs__tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tabs__panel" role="tabpanel">
        {tab === "shield" && <ShieldPanel api={api} />}
        {tab === "transfer" && <TransferPanel api={api} />}
        {tab === "unshield" && <UnshieldPanel api={api} />}
      </div>
    </div>
  );
}

type AssetListState = {
  loading: boolean;
  tokens: XrplToken[];
  error: string | null;
};

// Load an asset list from the controller, tracking loading/error state. `deps`
// re-runs the loader (the panels pass [api], which is stable post-boot).
function useAssetList(
  loader: () => Promise<XrplTokens | XrplToken[]>,
  deps: React.DependencyList,
): AssetListState {
  const [state, setState] = useState<AssetListState>({
    loading: true,
    tokens: [],
    error: null,
  });
  useEffect(() => {
    let active = true;
    setState({ loading: true, tokens: [], error: null });
    Promise.resolve()
      .then(loader)
      .then((res) => {
        const tokens = Array.isArray(res) ? res : res.tokens;
        if (active) setState({ loading: false, tokens, error: null });
      })
      .catch((err: unknown) => {
        if (active)
          setState({
            loading: false,
            tokens: [],
            error: (err as Error).message || String(err),
          });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function ShieldPanel({ api }: { api: WalletApi }) {
  const { loading, tokens, error } = useAssetList(
    () => api.getXrplTokens(),
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
      onSubmit={api.shield}
    />
  );
}

// Private transfer: send a shielded balance to another 0zk address. Funds stay
// in the pool (the broadcaster pays EVM gas). Pick which shielded token to send,
// the amount, then the recipient's 0zk address — same card as Shield.
function TransferPanel({ api }: { api: WalletApi }) {
  const { loading, tokens, error } = useAssetList(
    () => api.getShieldedTokens(),
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
// and amount; it unshields via RelayAdapt and bridges back to the connected
// XRPL account (the account holder) via Axelar — no recipient field needed.
function UnshieldPanel({ api }: { api: WalletApi }) {
  const { loading, tokens, error } = useAssetList(
    () => api.getShieldedTokens(),
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
      onSubmit={async ({ tokenId, amount }) => {
        const res = await api.unshield({ tokenAddress: tokenId, amount });
        return { txid: res.txHash };
      }}
    />
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
   * 0zk recipient field: `optional` shows a checkbox (defaults to self, used by
   * Shield), `required` always shows the input and blocks submit until valid
   * (used by Transfer). Omitted = no recipient field.
   */
  recipientMode?: "optional" | "required";
  recipientHint?: string;
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
  recipientHint,
  onSubmit,
}: AssetFormProps) {
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [useAltRecipient, setUseAltRecipient] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  // Default-select the first token once the list loads.
  useEffect(() => {
    if (tokens.length && !tokens.some((t) => t.id === tokenId))
      setTokenId(tokens[0].id);
  }, [tokens, tokenId]);

  if (loading) return <p className="panel__hint">Loading tokens…</p>;
  if (error) return <p className="panel__hint panel__hint--error">{error}</p>;
  if (!tokens.length) return <p className="panel__hint">{emptyHint}</p>;

  const selected = tokens.find((t) => t.id === tokenId);
  const amountOk =
    Number(amount) > 0 && Number(amount) <= Number(selected?.balance ?? 0);
  const recipientValid = recipient.startsWith("0zk") && recipient.length > 10;
  const needRecipient =
    recipientMode === "required" ||
    (recipientMode === "optional" && useAltRecipient);
  const recipientOk = !needRecipient || recipientValid;
  const canSubmit = Boolean(selected) && amountOk && recipientOk && !busy;

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
            >
              {tokens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="asset-card__token-name">
              {selected?.currency ?? "—"}
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
            <div className="asset-card__meta">
              <span className="asset-card__balance">
                Balance: {selected.balance}
              </span>
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

      {recipientMode === "optional" && (
        <label className="field">
          <span className="field__label field__label--inline">
            <input
              type="checkbox"
              checked={useAltRecipient}
              onChange={(e) => setUseAltRecipient(e.target.checked)}
            />
            Send to a different shielded address
          </span>
          {useAltRecipient && (
            <>
              <input
                className="field__input"
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0zk…"
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
          <span className="field__label">Recipient (0zk address)</span>
          <input
            className="field__input"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0zk…"
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
          {result.ok
            ? `✓ ${action} submitted${result.txid ? ` — ${result.txid.slice(0, 14)}…` : ""}`
            : `✕ ${result.message}`}
        </p>
      )}
    </form>
  );
}
