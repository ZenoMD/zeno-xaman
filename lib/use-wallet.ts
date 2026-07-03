"use client";

import { useEffect, useRef, useState } from "react";
import type { ShieldedTokenBalance, WalletApi } from "./types";

/**
 * Scan phase for the shielded balance:
 * - `idle`: wallet not booted yet (loading modules / awaiting sign-in)
 * - `scanning`: merkletree sync in progress
 * - `complete`: fully synced, balance is trustworthy
 */
export type ScanState = "idle" | "scanning" | "complete";

export type UseWalletState = {
  /** latest one-line progress/status message */
  status: string;
  /** timestamped activity log */
  logs: string[];
  /** RAILGUN (0zk) address, once derived */
  address: string | null;
  /** all shielded token balances (XRP is just another entry), highest first */
  shieldedTokens: ShieldedTokenBalance[];
  /** shielded balance scan phase (drives the dashed balance / "Scanning…") */
  scanState: ScanState;
  /** fatal boot error, if any */
  error: Error | null;
  /** wallet controller (tab actions), once booted */
  api: WalletApi | null;
};

/**
 * Boots the shielded wallet once on mount and exposes its progress as React
 * state. The heavy, browser-only wallet stack (RAILGUN + snarkjs + SQLite
 * worker + Xaman) is pulled in via a lazy `import()` so it is code-split out of
 * the initial page bundle and never evaluated during the static export.
 */
export function useWallet(): UseWalletState {
  const [status, setStatus] = useState("Loading…");
  const [logs, setLogs] = useState<string[]>(["loading modules…"]);
  const [shieldedTokens, setShieldedTokens] = useState<ShieldedTokenBalance[]>(
    [],
  );
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [api, setApi] = useState<WalletApi | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // guard against double-invocation
    started.current = true;

    const append = (line: string) =>
      setLogs((prev) => [
        ...prev,
        `${new Date().toISOString().slice(11, 19)}  ${line}`,
      ]);

    const log = (msg: string) => {
      // eslint-disable-next-line no-console
      console.log("[railgun]", msg);
      setStatus(msg);
      append(msg);
    };

    // Surface module load / runtime errors that would otherwise be invisible
    // inside the Xaman WebView (white screen, no console).
    const onError = (e: ErrorEvent) =>
      append(
        `error: ${e.message || ""}${e.filename ? ` @ ${e.filename}:${e.lineno}` : ""}`,
      );
    const onRejection = (e: PromiseRejectionEvent) =>
      append(`rejection: ${(e.reason && e.reason.message) || e.reason}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    let stop = () => {};
    let cancelled = false;
    import("./wallet")
      .then(({ startWallet }) =>
        startWallet({
          log,
          onAddress: setAddress,
          onShieldedTokens: setShieldedTokens,
          onScanState: setScanState,
        }),
      )
      .then((controller) => {
        // If the effect already tore down before boot finished, stop right away.
        if (cancelled) controller.stop();
        else {
          stop = controller.stop;
          setApi(controller);
        }
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(err);
        const e = err as Error;
        setError(e);
        log(`FATAL: ${e && e.stack ? e.stack : String(err)}`);
      });

    return () => {
      cancelled = true;
      stop();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return { status, logs, shieldedTokens, scanState, address, error, api };
}
