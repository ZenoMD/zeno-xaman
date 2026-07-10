"use client";

import { useEffect, useState } from "react";
import { useWallet } from "../lib/use-wallet";
import { WalletTabs } from "../components/wallet-tabs";
import CopyIcon from "../components/icons/copy.svg";
import CheckIcon from "../components/icons/check.svg";

const shortAddress = (addr: string) =>
  addr.length > 22 ? `${addr.slice(0, 12)}…${addr.slice(-6)}` : addr;

// Copy `text` to the clipboard, falling back to a hidden textarea + execCommand
// for the Xaman WebView, where the async Clipboard API is often unavailable.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// The shielded (0zk) address, tap-to-copy with brief "Copied!" feedback.
function CopyableAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyText(address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      className="balance-card__address"
      onClick={onCopy}
      title="Copy shielded address"
      aria-label={copied ? "Copied" : "Copy shielded address"}
    >
      <span className="balance-card__address-text">
        {shortAddress(address)}
      </span>
      <span className="balance-card__copy" aria-hidden="true">
        {copied ? (
          <CheckIcon width={15} height={15} />
        ) : (
          <CopyIcon width={15} height={15} />
        )}
      </span>
    </button>
  );
}

export default function Page() {
  const {
    status,
    logs,
    shieldedTokens,
    scanState,
    address,
    error,
    api,
    needsSignIn,
    signIn,
  } = useWallet();

  // Mirror Xaman's active palette (passed as the `xAppStyle` query param) onto
  // <html> so the theme-scoped CSS variables in globals.css take effect.
  useEffect(() => {
    const theme = (
      new URLSearchParams(window.location.search).get("xAppStyle") || "light"
    ).toLowerCase();
    document.documentElement.dataset.theme = theme;
  }, []);

  if (needsSignIn) {
    return (
      <main className="wallet">
        <section className="balance-card">
          <p className="balance-card__label">Shielded wallet</p>
          <p className="balance-card__empty">
            Sign in with your Xaman wallet to access your shielded account.
          </p>
          <button
            type="button"
            className="btn wallet__signin"
            onClick={signIn}
          >
            Sign in with Xaman
          </button>
          {error ? (
            <p className="panel__hint panel__hint--error">{error.message}</p>
          ) : null}
        </section>

        <p className="status">{status}</p>

        <details className="log">
          <summary>Logs</summary>
          <pre>{logs.join("\n")}</pre>
        </details>
      </main>
    );
  }

  return (
    <main className="wallet">
      <section className="balance-card">
        <p className="balance-card__label">Shielded balance</p>
        {scanState !== "complete" ? (
          <p className="balance-card__scanning">Scanning…</p>
        ) : shieldedTokens.length > 0 ? (
          <ul className="balance-card__tokens">
            {shieldedTokens.map((t) => (
              <li key={t.address} className="balance-card__token">
                <span className="balance-card__token-symbol">{t.symbol}</span>
                <span className="balance-card__token-amount">{t.balance}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="balance-card__empty">No shielded balance yet</p>
        )}
        {address ? (
          <CopyableAddress address={address} />
        ) : (
          <p className="balance-card__address">Connecting…</p>
        )}
      </section>

      {api ? (
        <WalletTabs api={api} />
      ) : (
        <section className="panel__hint">
          {error
            ? `Wallet failed to start: ${error.message}`
            : "Setting up your shielded wallet…"}
        </section>
      )}

      <p className="status">{status}</p>

      <details className="log">
        <summary>Logs</summary>
        <pre>{logs.join("\n")}</pre>
      </details>
    </main>
  );
}
