"use client";

import { useEffect, useRef, useState } from "react";

const shortAddress = (addr) =>
  addr.length > 22 ? `${addr.slice(0, 12)}…${addr.slice(-6)}` : addr;

export default function Page() {
  const [status, setStatus] = useState("Loading…");
  const [logs, setLogs] = useState(["loading modules…"]);
  const [balance, setBalance] = useState("—");
  const [address, setAddress] = useState("Connecting…");
  const started = useRef(false);

  // Mirror Xaman's active palette (passed as the `xAppStyle` query param) onto
  // <html> so the theme-scoped CSS variables in globals.css take effect.
  useEffect(() => {
    const theme = (
      new URLSearchParams(window.location.search).get("xAppStyle") || "light"
    ).toLowerCase();
    document.documentElement.dataset.theme = theme;
  }, []);

  useEffect(() => {
    if (started.current) return; // guard against double-invocation
    started.current = true;

    const append = (line) =>
      setLogs((prev) => [
        ...prev,
        `${new Date().toISOString().slice(11, 19)}  ${line}`,
      ]);

    const log = (msg) => {
      // eslint-disable-next-line no-console
      console.log("[railgun]", msg);
      setStatus(msg);
      append(msg);
    };

    // Surface module load / runtime errors that would otherwise be invisible
    // inside the Xaman WebView (white screen, no console).
    const onError = (e) =>
      append(
        `error: ${e.message || ""}${e.filename ? ` @ ${e.filename}:${e.lineno}` : ""}`,
      );
    const onRejection = (e) =>
      append(`rejection: ${(e.reason && e.reason.message) || e.reason}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    let stop = () => {};
    // Import the heavy, browser-only wallet stack lazily so it is never
    // evaluated during the static build.
    import("../lib/wallet.js")
      .then(({ startWallet }) =>
        startWallet({
          log,
          onAddress: (addr) => setAddress(shortAddress(addr)),
          onBalance: setBalance,
        }),
      )
      .then((cleanup) => {
        stop = cleanup;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        log(`FATAL: ${err && err.stack ? err.stack : err}`);
      });

    return () => {
      stop();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <main className="wallet">
      <header className="wallet__header">
        <h1 className="wallet__title">Zeno Wallet</h1>
        <span className="wallet__network">Sepolia</span>
      </header>

      <section className="balance-card">
        <p className="balance-card__label">Shielded balance</p>
        <p className="balance-card__amount">
          <span>{balance}</span> <span className="balance-card__unit">WETH</span>
        </p>
        <p className="balance-card__address">{address}</p>
      </section>

      <p className="status">{status}</p>

      <details className="log">
        <summary>Activity log</summary>
        <pre>{logs.join("\n")}</pre>
      </details>
    </main>
  );
}
