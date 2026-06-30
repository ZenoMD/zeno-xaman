"use client";

import { useEffect } from "react";
import { useWallet } from "../lib/use-wallet.js";
import { WalletTabs } from "../components/wallet-tabs.js";

const shortAddress = (addr) =>
  addr.length > 22 ? `${addr.slice(0, 12)}…${addr.slice(-6)}` : addr;

export default function Page() {
  const { status, logs, balance, address, error, api } = useWallet();

  // Mirror Xaman's active palette (passed as the `xAppStyle` query param) onto
  // <html> so the theme-scoped CSS variables in globals.css take effect.
  useEffect(() => {
    const theme = (
      new URLSearchParams(window.location.search).get("xAppStyle") || "light"
    ).toLowerCase();
    document.documentElement.dataset.theme = theme;
  }, []);

  return (
    <main className="wallet">
      <header className="wallet__header">
        <h1 className="wallet__title">Zeno Wallet</h1>
        <span className="wallet__network">XRPL EVM</span>
      </header>

      <section className="balance-card">
        <p className="balance-card__label">Shielded balance</p>
        <p className="balance-card__amount">
          <span>{balance}</span> <span className="balance-card__unit">XRP</span>
        </p>
        <p className="balance-card__address">
          {address ? shortAddress(address) : "Connecting…"}
        </p>
      </section>

      {api ? (
        <WalletTabs api={api} />
      ) : (
        <section className="panel__hint">
          {error ? `Wallet failed to start: ${error.message}` : "Setting up your shielded wallet…"}
        </section>
      )}

      <p className="status">{status}</p>

      <details className="log">
        <summary>Activity log</summary>
        <pre>{logs.join("\n")}</pre>
      </details>
    </main>
  );
}
