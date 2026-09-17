"use client";

import { useEffect, useState } from "react";
import { copyText } from "../lib/clipboard";
import { assetKey, trimAmount } from "../lib/tokens";
import type { AssetListState } from "../lib/use-asset-list";
import type { ScanState, ShieldedTokenBalance, TabId } from "../lib/types";
import ArrowIcon from "./icons/arrow-right.svg";
import CheckIcon from "./icons/check.svg";
import CopyIcon from "./icons/copy.svg";

/** How long the finished sync edge holds teal before settling into the border. */
const SYNC_CONFIRM_MS = 1400;
/** How long the copied confirmation stays on the address row. */
const COPIED_MS = 1500;

const shortAddress = (addr: string, head = 8, tail = 4) =>
  addr.length > head + tail + 4
    ? `${addr.slice(0, head)}…${addr.slice(-tail)}`
    : addr;

type PaneSide = "public" | "shielded" | "recipient";

/**
 * Which balance sits on which side, and which way the funds move. Public stays
 * on the left and shielded on the right across Shield and Unshield — the two
 * tabs differ by the arrow, the fold and which side is emphasised, not by
 * swapping the numbers around under the reader. A private transfer has no
 * public side at all, so its left pane is the shielded balance it spends.
 */
const FLOW: Record<
  TabId,
  { left: PaneSide; right: PaneSide; direction: "right" | "left" }
> = {
  shield: { left: "public", right: "shielded", direction: "right" },
  transfer: { left: "shielded", right: "recipient", direction: "right" },
  unshield: { left: "public", right: "shielded", direction: "left" },
};

const SIDE_LABEL: Record<PaneSide, string> = {
  public: "Public",
  shielded: "Shielded",
  recipient: "Recipient",
};

type PaneProps = {
  side: PaneSide;
  /** Source pane holds the balance being spent; it carries the emphasis. */
  role: "source" | "destination";
  align: "left" | "right";
  symbol: string;
  /** Formatted balance for this side; treated as zero once it is known. */
  amount?: string;
  /** Shown in place of the balance while the first read is in flight. */
  pending?: string;
  /**
   * The pending readout carries its own figure, so it drops the spinner: the
   * card's bottom edge is already drawing that progress. Indeterminate waits
   * keep the spinner, since nothing else is moving for them.
   */
  measured?: boolean;
  /** The read failed, so the balance is unknown — not zero. */
  unavailable?: boolean;
  /** Recipient address entered in the form — replaces the balance readout. */
  address?: string;
};

function Pane({
  side,
  role,
  align,
  symbol,
  amount,
  pending,
  measured,
  unavailable,
  address,
}: PaneProps) {
  const body = () => {
    if (address)
      return <p className="flow-card__dest">{shortAddress(address)}</p>;
    if (side === "recipient")
      return <p className="flow-card__note">another account</p>;
    if (pending)
      return (
        <p
          className={`flow-card__pending${
            measured ? " flow-card__pending--measured" : ""
          }`}
        >
          {pending}
        </p>
      );
    return (
      <p className="flow-card__amount">
        {unavailable ? "—" : trimAmount(amount ?? "0")}
        <span className="flow-card__symbol">{symbol}</span>
      </p>
    );
  };

  return (
    <div
      className={`flow-card__pane flow-card__pane--${align} flow-card__pane--${role}`}
    >
      <p className="flow-card__label">{SIDE_LABEL[side]}</p>
      {body()}
    </div>
  );
}

/**
 * The wallet's own shielded address, on the card that holds its balance. It is
 * an identity, not a direction of travel, so it lives here permanently rather
 * than behind a Receive mode competing with Shield/Transfer/Unshield.
 */
function AddressRow({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const onCopy = async () => {
    if (await copyText(address)) setCopied(true);
  };

  return (
    <button
      type="button"
      className="flow-card__address"
      onClick={onCopy}
      aria-label={copied ? "Address copied" : "Copy your shielded address"}
    >
      <span className="flow-card__address-lead">
        {copied ? "Address copied" : "Receive at"}
      </span>
      <span className="flow-card__address-value">
        {shortAddress(address, 12, 6)}
      </span>
      <span className="flow-card__address-icon" aria-hidden="true">
        {copied ? (
          <CheckIcon width={15} height={15} />
        ) : (
          <CopyIcon width={15} height={15} />
        )}
      </span>
    </button>
  );
}

export type FlowCardProps = {
  /** Active tab: sets the direction and what each pane holds. */
  tab: TabId;
  /** Symbol of the asset selected in the form below; both panes report on it. */
  symbol: string;
  /** Spendable assets in the connected XRPL wallet (the public side). */
  publicAssets: AssetListState;
  /** Live shielded balances (the shielded side). */
  shieldedTokens: ShieldedTokenBalance[];
  /** Shielded-balance sync: drives the pending pane and the card's bottom edge. */
  scan: ScanState;
  /** This wallet's 0zk address, once derived. */
  address?: string | null;
  /** Recipient entered in the form, if the funds are going to another account. */
  destination?: string;
};

/**
 * The wallet header: the selected asset on both sides of the move the active tab
 * makes. The destination half sits behind a diagonal fold — pinstriped, with the
 * crease running through the arrow — so the direction reads before the labels do.
 *
 * The card also carries the two things that describe the wallet rather than the
 * move: how far the shielded sync has got, drawn along its bottom edge, and the
 * address that shielded funds arrive at.
 */
export function FlowCard({
  tab,
  symbol,
  publicAssets,
  shieldedTokens,
  scan,
  address,
  destination,
}: FlowCardProps) {
  // The edge holds teal for a beat when the sync lands, then fades into the
  // ordinary hairline: completion is announced once and then stops being
  // furniture. It stays mounted at zero opacity, because it is a 2px rule with
  // nothing under it — cheaper than a second timer to unmount it.
  const synced = scan.phase === "complete";
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!synced) return;
    const timer = setTimeout(() => setSettled(true), SYNC_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [synced]);

  // Idle is 0, not 100: the wallet has not booted, so nothing has been scanned.
  const pct =
    scan.phase === "scanning" ? scan.progress * 100 : synced ? 100 : 0;

  const key = assetKey(symbol);
  const publicToken = publicAssets.tokens.find(
    (t) => assetKey(t.currency) === key,
  );
  const balances: Record<PaneSide, string | undefined> = {
    // Available (post-reserve) balance where known — same figure the Shield
    // form's MAX button fills in — falling back to the raw ledger balance for
    // assets with no reserve concept (issued currencies).
    public: publicToken?.available ?? publicToken?.balance,
    shielded: shieldedTokens.find((t) => assetKey(t.symbol) === key)?.balance,
    recipient: undefined,
  };
  // A refresh keeps the previous list, so only the first read is "pending" —
  // the rest of the time the pane holds the last balance it knew.
  const pending: Record<PaneSide, string | undefined> = {
    public:
      publicAssets.loading && !publicAssets.tokens.length
        ? "Loading…"
        : undefined,
    shielded: synced
      ? undefined
      : scan.phase === "scanning"
        ? `Scanning ${Math.round(scan.progress * 100)}%`
        : "Scanning…",
    recipient: undefined,
  };
  const unavailable: Record<PaneSide, boolean> = {
    public: Boolean(publicAssets.error),
    shielded: false,
    recipient: false,
  };

  const { left, right, direction } = FLOW[tab];
  const destinationSide = direction === "right" ? right : left;

  const pane = (side: PaneSide, align: "left" | "right") => (
    <Pane
      side={side}
      role={side === destinationSide ? "destination" : "source"}
      align={align}
      symbol={symbol}
      amount={balances[side]}
      pending={pending[side]}
      measured={side === "shielded" && scan.phase === "scanning"}
      unavailable={unavailable[side]}
      address={side === destinationSide ? destination : undefined}
    />
  );

  return (
    <section className={`flow-card flow-card--${direction}`}>
      <div className="flow-card__fold" aria-hidden="true" />
      <div className="flow-card__panes">
        {pane(left, "left")}
        <div className="flow-card__crease">
          <span className="flow-card__arrow">
            <ArrowIcon width={16} height={16} />
          </span>
        </div>
        {pane(right, "right")}
      </div>

      {address ? (
        <div className="flow-card__footer">
          <AddressRow address={address} />
        </div>
      ) : null}

      {/* Announced in the pane above as text; this is its visual twin. */}
      <div className="flow-card__sync" aria-hidden="true">
        <div
          className={`flow-card__sync-fill${synced ? " flow-card__sync-fill--done" : ""}${
            settled ? " flow-card__sync-fill--settled" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </section>
  );
}
