"use client";

import { useEffect, useState } from "react";
import type { ScanState } from "../lib/types";

/** How long the finished strip holds its confirmation before retracting. */
const CONFIRM_MS = 1800;
/** Must match the leave transition on `.sync-strip--leaving` in globals.css. */
const LEAVE_MS = 260;

export type SyncStripProps = {
  /** Where the shielded-balance sync has got to. */
  scan: ScanState;
};

/**
 * A band under the header card reporting the shielded-balance sync: a live
 * percentage while the merkletree scan runs, a confirmation when it lands, then
 * it retracts and stays gone. The balance below it is only as current as this
 * scan, and until now nothing said so or said when it had finished.
 *
 * One-shot by design. `startWallet` announces completion exactly once, and the
 * strip latches on that, so a later balance refresh can never splash it back up.
 */
export function SyncStrip({ scan }: SyncStripProps) {
  const [leaving, setLeaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const complete = scan.phase === "complete";

  useEffect(() => {
    if (!complete) return;
    const retract = setTimeout(() => setLeaving(true), CONFIRM_MS);
    const drop = setTimeout(() => setDismissed(true), CONFIRM_MS + LEAVE_MS);
    return () => {
      clearTimeout(retract);
      clearTimeout(drop);
    };
  }, [complete]);

  // Nothing to report before the scan starts, and nothing to add once the strip
  // has retracted.
  if (dismissed || scan.phase === "idle") return null;

  // Complete is 100% whatever the last fraction was: the engine's own terminal
  // event carries no progress at all (see ScanUpdate in lib/railgun.ts).
  const pct = scan.phase === "scanning" ? scan.progress * 100 : 100;

  return (
    <div
      className={`sync-strip${complete ? " sync-strip--done" : ""}${
        leaving ? " sync-strip--leaving" : ""
      }`}
      role="progressbar"
      aria-label="Shielded balance sync"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className="sync-strip__head">
        <span className="sync-strip__label">
          {complete ? "Shielded balance synced" : "Syncing shielded balance"}
        </span>
        <span className="sync-strip__value">{pct.toFixed(1)}%</span>
      </div>
      <div className="sync-strip__track">
        <div className="sync-strip__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
