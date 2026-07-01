"use client";

import { useEffect, useState } from "react";

const TABS = [
  { id: "shield", label: "Shield" },
  { id: "transfer", label: "Transfer" },
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
      allowRecipient
      onSubmit={api.shield}
    />
  );
}

// Private transfer: send shielded XRP to another 0zk address. Funds stay in the
// pool, so this needs only a recipient 0zk address + amount (no token picker).
function TransferPanel({ api }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const recipientOk = recipient.startsWith("0zk") && recipient.length > 10;
  const amountOk = Number(amount) > 0;
  const canSubmit = recipientOk && amountOk && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.transfer({ recipientAddress: recipient.trim(), amount });
      setResult({ ok: true, txid: res?.txHash });
      setAmount("");
    } catch (err) {
      setResult({ ok: false, message: err.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
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
      </label>

      <label className="field">
        <span className="field__label">Amount</span>
        <input
          className="field__input"
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
        />
        <span className="field__hint">Shielded XRP · stays private in the pool</span>
      </label>

      <button type="submit" className="btn" disabled={!canSubmit}>
        {busy ? "Proving & sending…" : "Transfer"}
      </button>

      {result && (
        <p className={`panel__result${result.ok ? "" : " panel__result--error"}`}>
          {result.ok
            ? `✓ Transfer submitted${result.txid ? ` — ${result.txid.slice(0, 14)}…` : ""}`
            : `✕ ${result.message}`}
        </p>
      )}
    </form>
  );
}

// Shared token + amount form. `onSubmit` receives { token, tokenId, amount,
// recipientAddress? } and resolves to { txid }. When `allowRecipient` is set the
// form offers an optional 0zk address to receive the shielded funds (defaults to
// the connected wallet's own shielded address when left off).
function AssetForm({ loading, error, tokens, emptyHint, action, busyLabel, allowRecipient, onSubmit }) {
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [useAltRecipient, setUseAltRecipient] = useState(false);
  const [recipient, setRecipient] = useState("");
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
  const recipientOk =
    !allowRecipient || !useAltRecipient || (recipient.startsWith("0zk") && recipient.length > 10);
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
        recipientAddress:
          allowRecipient && useAltRecipient ? recipient.trim() : undefined,
      });
      setResult({ ok: true, txid: res?.txid });
      setAmount("");
    } catch (err) {
      setResult({ ok: false, message: err.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
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

      {allowRecipient && (
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
                Recipient's 0zk address. Leave off to shield to yourself.
              </span>
            </>
          )}
        </label>
      )}

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
