"use client";

import { useEffect, useState } from "react";

const TABS = [
  { id: "shield", label: "Shield" },
  { id: "transfer", label: "Transfer" },
  { id: "unshield", label: "Unshield" },
];

export function WalletTabs({ api }) {
  const [tab, setTab] = useState("shield");

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

// Load an asset list from the controller, tracking loading/error state. `deps`
// re-runs the loader (the panels pass [api], which is stable post-boot).
function useAssetList(loader, deps) {
  const [state, setState] = useState({ loading: true, tokens: [], error: null });
  useEffect(() => {
    let active = true;
    setState({ loading: true, tokens: [], error: null });
    Promise.resolve()
      .then(loader)
      .then((res) => {
        if (active) setState({ loading: false, tokens: res.tokens ?? res, error: null });
      })
      .catch((err) => {
        if (active) setState({ loading: false, tokens: [], error: err.message || String(err) });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function ShieldPanel({ api }) {
  const { loading, tokens, error } = useAssetList(() => api.getXrplTokens(), [api]);
  return (
    <AssetForm
      loading={loading}
      error={error}
      tokens={tokens}
      emptyHint="No tokens found in your XRPL wallet."
      action="Shield"
      busyLabel="Shielding…"
      onSubmit={api.shield}
    />
  );
}

function TransferPanel({ api }) {
  const { loading, tokens, error } = useAssetList(() => api.getShieldedTokens(), [api]);
  return (
    <AssetForm
      loading={loading}
      error={error}
      tokens={tokens}
      emptyHint="No shielded tokens to transfer."
      recipient={{ label: "Recipient (0zk address)", placeholder: "0zk1qy…" }}
      action="Transfer"
      busyLabel="Transferring…"
      onSubmit={api.transfer}
    />
  );
}

function UnshieldPanel({ api }) {
  const { loading, tokens, error } = useAssetList(() => api.getShieldedTokens(), [api]);
  return (
    <AssetForm
      loading={loading}
      error={error}
      tokens={tokens}
      emptyHint="No shielded tokens to unshield."
      action="Unshield"
      busyLabel="Unshielding…"
      onSubmit={api.unshield}
    />
  );
}

// Shared token + amount form. `recipient` (optional) adds a destination field;
// `onSubmit` receives { token, tokenId, amount, to? } and resolves to { txid }.
function AssetForm({ loading, error, tokens, emptyHint, recipient, action, busyLabel, onSubmit }) {
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  // Default-select the first token once the list loads.
  useEffect(() => {
    if (tokens.length && !tokens.some((t) => t.id === tokenId)) setTokenId(tokens[0].id);
  }, [tokens, tokenId]);

  if (loading) return <p className="panel__hint">Loading tokens…</p>;
  if (error) return <p className="panel__hint panel__hint--error">{error}</p>;
  if (!tokens.length) return <p className="panel__hint">{emptyHint}</p>;

  const selected = tokens.find((t) => t.id === tokenId);
  const amountOk = Number(amount) > 0 && Number(amount) <= Number(selected?.balance ?? 0);
  const recipientOk = !recipient || to.trim().length > 0;
  const canSubmit = selected && amountOk && recipientOk && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await onSubmit({
        token: selected.currency,
        tokenId: selected.id,
        amount,
        ...(recipient ? { to: to.trim() } : {}),
      });
      setResult({ ok: true, txid: res?.txid });
      setAmount("");
      if (recipient) setTo("");
    } catch (err) {
      setResult({ ok: false, message: err.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      {recipient && (
        <label className="field">
          <span className="field__label">{recipient.label}</span>
          <input
            className="field__input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={recipient.placeholder}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      )}

      <label className="field">
        <span className="field__label">Token</span>
        <select
          className="field__input"
          value={tokenId}
          onChange={(e) => setTokenId(e.target.value)}
        >
          {tokens.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} — {t.balance}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Amount</span>
        <div className="field__amount">
          <input
            className="field__input"
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
          />
          {selected && (
            <button
              type="button"
              className="field__max"
              onClick={() => setAmount(selected.balance)}
            >
              MAX
            </button>
          )}
        </div>
        {selected && (
          <span className="field__hint">
            Balance: {selected.balance} {selected.currency}
          </span>
        )}
      </label>

      <button type="submit" className="btn" disabled={!canSubmit}>
        {busy ? busyLabel : action}
      </button>

      {result && (
        <p className={`panel__result${result.ok ? "" : " panel__result--error"}`}>
          {result.ok
            ? `✓ ${action} submitted (mock)${result.txid ? ` — ${result.txid.slice(0, 14)}…` : ""}`
            : `✕ ${result.message}`}
        </p>
      )}
    </form>
  );
}
