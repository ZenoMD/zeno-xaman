"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEV_ACCOUNT, DEV_XRPL_ACCOUNT } from "./dev-account";
import { isXappRuntime } from "./runtime";
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
  /** true in a regular browser until the user has signed in with Xaman */
  needsSignIn: boolean;
  /** trigger the Xaman OAuth2 sign-in (browser mode); no-op inside the xApp */
  signIn: () => void;
};

/**
 * Boots the shielded wallet once on mount and exposes its progress as React
 * state. The heavy, browser-only wallet stack (RAILGUN + snarkjs + SQLite
 * worker + Xaman) is pulled in via a lazy `import()` so it is code-split out of
 * the initial page bundle and never evaluated during the static export.
 *
 * Two environments are supported (https://docs.xaman.dev/environments):
 *  - Xaman xApp: the session is established automatically, so the wallet boots
 *    on mount (`needsSignIn` stays false).
 *  - regular browser ("browser/web3"): the user must sign in with Xaman over
 *    OAuth2 first; `needsSignIn` gates a "Sign in" button that calls `signIn()`.
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
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const started = useRef(false);
  const signInRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (started.current) return; // guard against double-invocation

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
    let unsubscribe = () => {};
    let cancelled = false;

    // Boot the heavy, browser-only wallet stack. Once a Xaman session exists
    // (auto inside the xApp, or after OAuth2 sign-in in the browser) the flow is
    // identical, so this runs the same in both environments.
    const boot = () => {
      if (started.current) return; // never boot twice
      started.current = true;
      setNeedsSignIn(false);
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
          // If the effect already tore down before boot finished, stop it.
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
    };

    // Inside the Xaman xApp the session is set up automatically, so boot
    // straight away. In a regular browser we follow Xaman's "browser/web3"
    // flow: construct the SDK, let it restore any existing 24h session, and
    // boot when a session is available — otherwise show a "Sign in" button that
    // starts the OAuth2 flow. https://docs.xaman.dev/environments/browser-web3
    //
    // The dev overrides only skip sign-in when they cover BOTH halves of the
    // identity: DEV_ACCOUNT replaces the shielded keys, and DEV_XRPL_ACCOUNT
    // replaces the XRPL account the Shield tab reads. DEV_ACCOUNT alone used to
    // boot straight past sign-in, which left the browser with no session — and
    // `xumm.user.account` then never settles at all, so the public balance hung
    // on "loading" forever.
    if (isXappRuntime() || (DEV_ACCOUNT && DEV_XRPL_ACCOUNT)) {
      boot();
    } else {
      setStatus("Connecting to Xaman…");
      // The SDK is event-driven: `success` fires for a fresh sign-in, a restored
      // session, AND the return leg of the mobile deeplink flow (where the page
      // has reloaded, so authorize()'s promise is gone) — so we drive off events
      // rather than authorize()'s return value.
      import("./xumm-client")
        .then(({ getXumm }) => {
          if (cancelled) return;
          const xumm = getXumm();

          const onSuccess = () => boot(); // boot() is idempotent
          // `ready` = SDK finished restoring any saved session. If that didn't
          // sign us in, reveal the sign-in button.
          const onReady = () => {
            if (started.current) return;
            setNeedsSignIn(true);
            setStatus("Sign in with Xaman to continue");
          };
          const onAuthError = (e: unknown) => {
            const err = e as Error;
            setError(err);
            setNeedsSignIn(true);
            setStatus("Sign in with Xaman to continue");
            log(`sign-in error: ${err?.message ?? String(e)}`);
          };

          xumm.on("success", onSuccess);
          xumm.on("ready", onReady);
          xumm.on("error", onAuthError);
          unsubscribe = () => {
            xumm.off("success", onSuccess);
            xumm.off("ready", onReady);
            xumm.off("error", onAuthError);
          };

          // Sign-in button: start the OAuth2 login (QR popup on desktop, deeplink
          // redirect on mobile). Called straight from the click so the popup is
          // tied to the user gesture; the `success` event does the booting.
          signInRef.current = () => {
            setError(null);
            setStatus("Waiting for Xaman sign-in…");
            Promise.resolve(xumm.authorize()).catch((err: unknown) => {
              const e = err as Error;
              setError(e);
              setNeedsSignIn(true);
              setStatus("Sign in with Xaman to continue");
              log(`sign-in failed: ${e?.message ?? String(err)}`);
            });
          };
        })
        .catch((err: unknown) => {
          const e = err as Error;
          setError(e);
          setNeedsSignIn(true);
          log(`FATAL: ${e && e.stack ? e.stack : String(err)}`);
        });
    }

    return () => {
      cancelled = true;
      stop();
      unsubscribe();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const signIn = useCallback(() => signInRef.current(), []);

  return {
    status,
    logs,
    shieldedTokens,
    scanState,
    address,
    error,
    api,
    needsSignIn,
    signIn,
  };
}
