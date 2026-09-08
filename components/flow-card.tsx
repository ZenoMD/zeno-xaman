"use client";

import { assetKey, trimAmount } from "../lib/tokens";
import type { AssetListState } from "../lib/use-asset-list";
import type { ShieldedTokenBalance, TabId } from "../lib/types";
import ArrowIcon from "./icons/arrow-right.svg";

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
  /** First read of this side is still in flight; there is nothing to show yet. */
  pending?: boolean;
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
        <p className="flow-card__pending">
          {side === "shielded" ? "Scanning…" : "Loading…"}
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

export type FlowCardProps = {
  /** Active tab: sets the direction and what each pane holds. */
  tab: TabId;
  /** Symbol of the asset selected in the form below; both panes report on it. */
  symbol: string;
  /** Spendable assets in the connected XRPL wallet (the public side). */
  publicAssets: AssetListState;
  /** Live shielded balances (the shielded side). */
  shieldedTokens: ShieldedTokenBalance[];
  /** True until the shielded scan completes, when balances aren't trustworthy. */
  scanning: boolean;
  /** Recipient entered in the form, if the funds are going to another account. */
  destination?: string;
  /** Receiving: nothing is moving, so the card collapses to one balance. */
  receive?: boolean;
};

/**
 * The wallet header: the selected asset on both sides of the move the active tab
 * makes. The destination half sits behind a diagonal fold — pinstriped, with the
 * crease running through the arrow — so the direction reads before the labels do.
 * It replaced a single "Shielded balance" readout, which showed the pool balance
 * while the Shield form was spending the public one.
 */
export function FlowCard({
  tab,
  symbol,
  publicAssets,
  shieldedTokens,
  scanning,
  destination,
  receive,
}: FlowCardProps) {
  const key = assetKey(symbol);
  const balances: Record<PaneSide, string | undefined> = {
    public: publicAssets.tokens.find((t) => assetKey(t.currency) === key)
      ?.balance,
    shielded: shieldedTokens.find((t) => assetKey(t.symbol) === key)?.balance,
    recipient: undefined,
  };
  // A refresh keeps the previous list, so only the first read is "pending" —
  // the rest of the time the pane holds the last balance it knew.
  const pending: Record<PaneSide, boolean> = {
    public: publicAssets.loading && !publicAssets.tokens.length,
    shielded: scanning,
    recipient: false,
  };
  const unavailable: Record<PaneSide, boolean> = {
    public: Boolean(publicAssets.error),
    shielded: false,
    recipient: false,
  };

  if (receive) {
    return (
      <section className="flow-card flow-card--single">
        <div className="flow-card__panes">
          <Pane
            side="shielded"
            role="source"
            align="left"
            symbol={symbol}
            amount={balances.shielded}
            pending={pending.shielded}
          />
        </div>
      </section>
    );
  }

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
    </section>
  );
}
