import {
  NETWORK_CONFIG,
  type NetworkName,
} from "@railgun-community/shared-models";
import { getFallbackProviderForNetwork } from "@railgun-community/wallet";
import { Contract, type ContractRunner } from "ethers";

// The RAILGUN pool charges a fee on every shield and every unshield, set in
// basis points by its governance and readable straight off the proxy. Read it
// rather than hardcoding it: the unshield leg has to bridge EXACTLY what the
// RelayAdapt is left holding (a wrong number over-requests and reverts the ITS
// burn), and the quote shown to the user has to be the same number the
// transaction uses.

const POOL_FEE_ABI = [
  "function shieldFee() view returns (uint120)",
  "function unshieldFee() view returns (uint120)",
];

export type PoolFeeBasisPoints = {
  /** Deducted from what the pool receives, so a shield credits `value - fee`. */
  shield: bigint;
  /** Deducted from what is unshielded, so the recipient gets `value - fee`. */
  unshield: bigint;
};

// Governance can change these, but not often; a few minutes of staleness is far
// cheaper than an RPC round trip on every keystroke.
const FEE_CACHE_MS = 5 * 60_000;

let cache:
  { networkName: string; fees: PoolFeeBasisPoints; at: number } | undefined;
let inFlight: Promise<PoolFeeBasisPoints> | undefined;

/** Mirrors UnshieldNote.getAmountFeeFromValue: fee = value * bp / 10000. */
export const feeFromValue = (
  value: bigint,
  basisPoints: bigint,
): { amount: bigint; fee: bigint } => {
  const fee = (value * basisPoints) / 10000n;
  return { amount: value - fee, fee };
};

/**
 * The pool's live shield/unshield fees in basis points. Cached for 5 minutes and
 * single-flighted, so calling it per keystroke costs at most one eth_call per
 * cache window. THROWS if the read fails — callers decide whether that aborts a
 * transaction or just marks a quote incomplete.
 */
export function getPoolFeeBasisPoints(
  networkName: NetworkName,
): Promise<PoolFeeBasisPoints> {
  if (
    cache &&
    cache.networkName === networkName &&
    Date.now() - cache.at < FEE_CACHE_MS
  ) {
    return Promise.resolve(cache.fees);
  }
  if (inFlight) return inFlight;

  inFlight = readPoolFees(networkName)
    .then((fees) => {
      cache = { networkName, fees, at: Date.now() };
      return fees;
    })
    .finally(() => {
      inFlight = undefined;
    });

  return inFlight;
}

async function readPoolFees(
  networkName: NetworkName,
): Promise<PoolFeeBasisPoints> {
  const { proxyContract } = NETWORK_CONFIG[networkName];
  if (!proxyContract) {
    throw new Error(`No RAILGUN pool configured for ${networkName}`);
  }
  // The engine's own provider, so the fee read hits the same RPC as everything
  // else. Cast because the SDK bundles an older ethers whose Provider type is
  // structurally identical but nominally distinct from ours.
  const provider = getFallbackProviderForNetwork(
    networkName,
  ) as unknown as ContractRunner;
  const pool = new Contract(proxyContract, POOL_FEE_ABI, provider);
  const [shield, unshield] = await Promise.all([
    pool.shieldFee() as Promise<bigint>,
    pool.unshieldFee() as Promise<bigint>,
  ]);
  return { shield, unshield };
}
