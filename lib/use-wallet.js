"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Boots the shielded wallet once on mount and exposes its progress as React
 * state. The heavy, browser-only wallet stack (RAILGUN + snarkjs + SQLite
 * worker + Xaman) is pulled in via a lazy `import()` so it is code-split out of
 * the initial page bundle and never evaluated during the static export.
 *
 * @returns {{
 *   status: string,            // latest one-line progress/status message
 *   logs: string[],            // timestamped activity log
 *   address: string | null,    // RAILGUN (0zk) address, once derived
 *   balance: string,           // formatted shielded WETH balance
 *   error: Error | null,       // fatal boot error, if any
 *   api: object | null,        // wallet controller (tab actions), once booted
 * }}
 */
export function useWallet() {
  const [status, setStatus] = useState("Loading…");
  const [logs, setLogs] = useState(["loading modules…"]);
  const [balance, setBalance] = useState("—");
  const [address, setAddress] = useState(null);
  const [error, setError] = useState(null);
  const [api, setApi] = useState(null);
  const started = useRef(false);

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
    let cancelled = false;
    import("./wallet.js")
      .then(({ startWallet }) =>
        startWallet({ log, onAddress: setAddress, onBalance: setBalance }),
      )
      .then((controller) => {
        // If the effect already tore down before boot finished, stop right away.
        if (cancelled) controller.stop();
        else {
          stop = controller.stop;
          setApi(controller);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        setError(err);
        log(`FATAL: ${err && err.stack ? err.stack : err}`);
      });

    return () => {
      cancelled = true;
      stop();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return { status, logs, balance, address, error, api };
}
