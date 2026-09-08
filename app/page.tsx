"use client";

import { useCallback, useState } from "react";
import { useWallet } from "../lib/use-wallet";
import { useAssetList } from "../lib/use-asset-list";
import { FlowCard } from "../components/flow-card";
import { WalletTabs } from "../components/wallet-tabs";
import type { FlowSelection, TabId } from "../lib/types";

export default function Page() {
  const {
    status,
    logs,
    shieldedTokens,
    scanState,
    error,
    api,
    needsSignIn,
    signIn,
  } = useWallet();

  // The active tab and the asset the form is working on both live here: the
  // header card shows that asset's balance on either side of the move.
  const [tab, setTab] = useState<TabId>("shield");
  const [flow, setFlow] = useState<FlowSelection>({});
  const onFlow = useCallback((next: FlowSelection) => setFlow(next), []);

  // The connected XRPL wallet's assets back both the Shield form and the card's
  // public pane. Re-read on every tab change so a bridge that has landed in the
  // meantime shows up.
  const publicAssets = useAssetList(
    () => (api ? api.getXrplTokens() : Promise.resolve([])),
    [api, tab],
  );

  if (needsSignIn) {
    return (
      <main className="wallet">
        <section className="balance-card">
          <p className="balance-card__label">Shielded wallet</p>
          <p className="balance-card__empty">
            Sign in with your Xaman wallet to access your shielded account.
          </p>
          <button type="button" className="btn wallet__signin" onClick={signIn}>
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
      <FlowCard
        tab={tab}
        // XRP leads every token list, so it is also the right stand-in while the
        // active form is still loading its own.
        symbol={flow.symbol ?? "XRP"}
        destination={flow.destination}
        receive={flow.receive}
        publicAssets={publicAssets}
        shieldedTokens={shieldedTokens}
        scanning={scanState !== "complete"}
      />

      {api ? (
        <WalletTabs
          api={api}
          tab={tab}
          onTabChange={setTab}
          publicAssets={publicAssets}
          onFlow={onFlow}
        />
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
