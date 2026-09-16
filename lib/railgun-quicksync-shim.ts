// Build-time replacement for @railgun-community/wallet's internal
// `dist/services/railgun/quick-sync/quick-sync-events.js` (wired up via
// NormalModuleReplacementPlugin in next.config.js). Its exported
// `quickSyncEventsGraph` is the function the engine calls to bulk-fetch shielded
// event history before the slow RPC scan. Upstream maps chains to RAILGUN's
// hosted Subsquid endpoints and throws "No Graph API hosted service" for
// anything else — including our custom XRPL_EVM network — so on XRPL EVM the
// engine always falls back to paging getLogs (SCAN_CHUNKS=499, serial, 5s
// timeouts) against a single public RPC from the deployment block. That is the
// dominant first-sync cost for new users.
//
// This shim serves quickSync for XRPL EVM from our own Goldsky-hosted RAILGUN V2
// subgraph (Graph Protocol dialect), turning the genesis scan into a few bulk
// GraphQL queries. The commitment/nullifier/unshield formatting is ported
// verbatim from the wallet package's graph-type-formatters-v2.js /
// shared-formatters.js (they only use @railgun-community/engine public exports,
// which the package's own `exports` map otherwise blocks us from importing).
//
// For any other chain/txidVersion this returns empty events, so the engine
// simply falls back to its normal scan — nothing else is affected.
import {
  ByteUtils,
  ByteLength,
  CommitmentType,
  TokenType,
  serializeTokenData,
  serializePreImage,
  type AccumulatedEvents,
  type Chain,
} from "@railgun-community/engine";
import { TXIDVersion } from "@railgun-community/shared-models";
import { getAddress } from "ethers";

// Our Goldsky-hosted fork of Railgun-Community/subgraph-v2-template, retargeted
// to XRPL EVM (proxyContract 0x83f2…02EA, startBlock 6552860).
const GOLDSKY_URL =
  "https://api.goldsky.com/api/public/project_cmr4777j8ohwe01wm2r1oextv/subgraphs/railgun-v2-xrpl-evm/1.0.0/gn";

// The chain this shim answers for. Everything else falls through to empty →
// engine does its default scan.
const XRPL_EVM_CHAIN_ID = 1440000;

// The Graph caps `first` at 1000 rows/page. We page by a blockNumber cursor and
// de-dupe by id, exactly like the wallet's autoPaginatingQuery.
const PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// GraphQL (Graph Protocol dialect: first / orderDirection, not Subsquid limit).
// Field selections mirror the wallet's V2 CommitmentsDocument/etc. so the ported
// formatters below receive exactly the shapes they expect.
// ---------------------------------------------------------------------------

const NULLIFIERS_QUERY = `
  query Nullifiers($blockNumber: BigInt!) {
    nullifiers(first: ${PAGE_SIZE}, orderBy: blockNumber, orderDirection: asc, where: { blockNumber_gte: $blockNumber }) {
      id
      blockNumber
      nullifier
      transactionHash
      blockTimestamp
      treeNumber
    }
  }`;

const UNSHIELDS_QUERY = `
  query Unshields($blockNumber: BigInt!) {
    unshields(first: ${PAGE_SIZE}, orderBy: blockNumber, orderDirection: asc, where: { blockNumber_gte: $blockNumber }) {
      id
      blockNumber
      to
      transactionHash
      fee
      blockTimestamp
      amount
      eventLogIndex
      token { id tokenType tokenSubID tokenAddress }
    }
  }`;

const COMMITMENTS_QUERY = `
  query Commitments($blockNumber: BigInt!) {
    commitments(first: ${PAGE_SIZE}, orderBy: blockNumber, orderDirection: asc, where: { blockNumber_gte: $blockNumber }) {
      id
      treeNumber
      batchStartTreePosition
      treePosition
      blockNumber
      transactionHash
      blockTimestamp
      commitmentType
      hash
      ... on LegacyGeneratedCommitment {
        encryptedRandom
        preimage { npk value token { tokenType tokenSubID tokenAddress } }
      }
      ... on LegacyEncryptedCommitment {
        legacyCiphertext: ciphertext {
          ciphertext { iv tag data }
          ephemeralKeys
          memo
        }
      }
      ... on ShieldCommitment {
        shieldKey
        fee
        encryptedBundle
        preimage { npk value token { tokenType tokenSubID tokenAddress } }
      }
      ... on TransactCommitment {
        ciphertext {
          ciphertext { iv tag data }
          blindedSenderViewingKey
          blindedReceiverViewingKey
          annotationData
          memo
        }
      }
    }
  }`;

type Row = { id: string; blockNumber: string };

async function gqlQuery<T>(query: string, blockNumber: string): Promise<T[]> {
  const res = await fetch(GOLDSKY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { blockNumber } }),
  });
  if (!res.ok) {
    throw new Error(`Goldsky quickSync HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Record<string, T[]>;
    errors?: unknown;
  };
  if (json.errors) {
    throw new Error(
      `Goldsky quickSync GraphQL error: ${JSON.stringify(json.errors)}`,
    );
  }
  const data = json.data ?? {};
  // Single root field per query; return its rows.
  return Object.values(data)[0] ?? [];
}

// Page a query by blockNumber cursor until a short page, de-duping by id. Mirrors
// the wallet's autoPaginatingQuery: re-querying with blockNumber_gte the last
// block re-includes that block's rows, which the id de-dupe drops.
async function fetchAll<T extends Row>(
  query: string,
  fromBlock: string,
): Promise<T[]> {
  const byId = new Map<string, T>();
  let cursor = fromBlock;
  for (;;) {
    const rows = await gqlQuery<T>(query, cursor);
    let added = 0;
    for (const row of rows) {
      if (!byId.has(row.id)) {
        byId.set(row.id, row);
        added += 1;
      }
    }
    if (rows.length < PAGE_SIZE) break;
    const lastBlock = rows[rows.length - 1].blockNumber;
    // No forward progress (a single block larger than a page) — stop rather than
    // loop forever. Not expected at XRPL EVM volumes.
    if (lastBlock === cursor && added === 0) break;
    cursor = lastBlock;
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Formatting — ported verbatim from the wallet package's
// graph-type-formatters-v2.js + shared-formatters.js.
// ---------------------------------------------------------------------------

const formatTo32Bytes = (value: string) =>
  ByteUtils.formatToByteLength(value, ByteLength.UINT_256, false);
const formatTo16Bytes = (value: string) =>
  ByteUtils.formatToByteLength(value, ByteLength.UINT_128, false);
const bigIntStringToHex = (v: string) => `0x${BigInt(v).toString(16)}`;

const graphTokenType = (t: string): TokenType =>
  t === "ERC721"
    ? TokenType.ERC721
    : t === "ERC1155"
      ? TokenType.ERC1155
      : TokenType.ERC20;

type GraphToken = {
  tokenType: string;
  tokenSubID: string;
  tokenAddress: string;
};
type GraphPreImage = { npk: string; value: string; token: GraphToken };

const formatPreImage = (p: GraphPreImage) =>
  serializePreImage(
    p.npk,
    serializeTokenData(
      p.token.tokenAddress,
      graphTokenType(p.token.tokenType),
      p.token.tokenSubID,
    ),
    BigInt(p.value),
  );

type GraphCiphertext = { iv: string; tag: string; data: string[] };
const formatCiphertext = (c: GraphCiphertext) => ({
  iv: formatTo16Bytes(c.iv),
  tag: formatTo16Bytes(c.tag),
  data: c.data.map(formatTo32Bytes),
});

interface GraphCommitment {
  id: string;
  commitmentType: string;
  hash: string;
  transactionHash: string;
  blockNumber: string;
  blockTimestamp: string;
  treeNumber: number;
  treePosition: number;
  batchStartTreePosition: number;
  encryptedRandom?: [string, string];
  preimage?: GraphPreImage;
  legacyCiphertext?: {
    ciphertext: GraphCiphertext;
    ephemeralKeys: string[];
    memo: string[];
  };
  ciphertext?: {
    ciphertext: GraphCiphertext;
    blindedSenderViewingKey: string;
    blindedReceiverViewingKey: string;
    annotationData: string;
    memo: string;
  };
  shieldKey?: string;
  fee?: string;
  encryptedBundle?: [string, string, string];
}

const formatCommitment = (c: GraphCommitment): any => {
  const base = {
    txid: formatTo32Bytes(c.transactionHash),
    timestamp: Number(c.blockTimestamp),
    hash: formatTo32Bytes(bigIntStringToHex(c.hash)),
    blockNumber: Number(c.blockNumber),
    utxoTree: c.treeNumber,
    utxoIndex: c.treePosition,
  };
  switch (c.commitmentType) {
    case "LegacyGeneratedCommitment":
      return {
        ...base,
        commitmentType: CommitmentType.LegacyGeneratedCommitment,
        preImage: formatPreImage(c.preimage!),
        encryptedRandom: [
          formatTo32Bytes(c.encryptedRandom![0]),
          formatTo16Bytes(c.encryptedRandom![1]),
        ],
      };
    case "LegacyEncryptedCommitment":
      return {
        ...base,
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        ciphertext: {
          ciphertext: formatCiphertext(c.legacyCiphertext!.ciphertext),
          ephemeralKeys: c.legacyCiphertext!.ephemeralKeys.map(formatTo32Bytes),
          memo: c.legacyCiphertext!.memo.map(formatTo32Bytes),
        },
        railgunTxid: undefined,
      };
    case "ShieldCommitment": {
      const shield: any = {
        ...base,
        commitmentType: CommitmentType.ShieldCommitment,
        preImage: formatPreImage(c.preimage!),
        encryptedBundle: c.encryptedBundle,
        shieldKey: c.shieldKey,
        fee: c.fee != null ? c.fee.toString() : undefined,
        from: undefined,
      };
      if (shield.fee == null) delete shield.fee;
      return shield;
    }
    case "TransactCommitment":
    default:
      return {
        ...base,
        commitmentType: CommitmentType.TransactCommitmentV2,
        ciphertext: {
          ciphertext: formatCiphertext(c.ciphertext!.ciphertext),
          blindedReceiverViewingKey: formatTo32Bytes(
            c.ciphertext!.blindedReceiverViewingKey,
          ),
          blindedSenderViewingKey: formatTo32Bytes(
            c.ciphertext!.blindedSenderViewingKey,
          ),
          memo: c.ciphertext!.memo,
          annotationData: c.ciphertext!.annotationData,
        },
        railgunTxid: undefined,
      };
  }
};

// Group flat commitments into batches keyed by (treeNumber, batchStartTreePosition),
// then order by tree + position — mirrors createGraphCommitmentBatches +
// sortByTreeNumberAndStartPosition upstream.
const buildCommitmentEvents = (commitments: GraphCommitment[]) => {
  const batches = new Map<
    string,
    {
      transactionHash: string;
      treeNumber: number;
      startPosition: number;
      blockNumber: number;
      commitments: GraphCommitment[];
    }
  >();
  for (const c of commitments) {
    const key = `${c.treeNumber}-${c.batchStartTreePosition}`;
    const existing = batches.get(key);
    if (existing) {
      existing.commitments.push(c);
    } else {
      batches.set(key, {
        transactionHash: c.transactionHash,
        treeNumber: c.treeNumber,
        startPosition: c.batchStartTreePosition,
        blockNumber: Number(c.blockNumber),
        commitments: [c],
      });
    }
  }
  return [...batches.values()]
    .sort(
      (a, b) =>
        a.treeNumber - b.treeNumber || a.startPosition - b.startPosition,
    )
    .map((batch) => ({
      txid: formatTo32Bytes(batch.transactionHash),
      commitments: batch.commitments.map(formatCommitment),
      treeNumber: batch.treeNumber,
      startPosition: batch.startPosition,
      blockNumber: batch.blockNumber,
    }));
};

// ---------------------------------------------------------------------------

export const quickSyncEventsGraph = async (
  txidVersion: TXIDVersion,
  chain: Chain,
  startingBlock: number,
): Promise<AccumulatedEvents> => {
  const empty: AccumulatedEvents = {
    commitmentEvents: [],
    unshieldEvents: [],
    nullifierEvents: [],
  };

  // Only our chain, only V2 (XRPL EVM has supportsV3: false). Anything else →
  // empty, so the engine performs its default scan for that case.
  if (
    chain.id !== XRPL_EVM_CHAIN_ID ||
    txidVersion !== TXIDVersion.V2_PoseidonMerkle
  ) {
    return empty;
  }

  const fromBlock = String(startingBlock);

  const [nullifiers, unshields, commitments] = await Promise.all([
    fetchAll<any>(NULLIFIERS_QUERY, fromBlock),
    fetchAll<any>(UNSHIELDS_QUERY, fromBlock),
    fetchAll<GraphCommitment & Row>(COMMITMENTS_QUERY, fromBlock),
  ]);

  const nullifierEvents = nullifiers.map((n) => ({
    txid: formatTo32Bytes(n.transactionHash),
    nullifier: formatTo32Bytes(n.nullifier),
    treeNumber: n.treeNumber,
    blockNumber: Number(n.blockNumber),
    spentRailgunTxid: undefined,
  }));

  const unshieldEvents = unshields.map((u) => ({
    txid: formatTo32Bytes(u.transactionHash),
    timestamp: Number(u.blockTimestamp),
    eventLogIndex: Number(u.eventLogIndex),
    toAddress: getAddress(u.to),
    tokenType: graphTokenType(u.token.tokenType),
    tokenAddress: getAddress(u.token.tokenAddress),
    tokenSubID: u.token.tokenSubID,
    amount: bigIntStringToHex(u.amount),
    fee: bigIntStringToHex(u.fee),
    blockNumber: Number(u.blockNumber),
    railgunTxid: undefined,
    poisPerList: undefined,
    blindedCommitment: undefined,
  }));

  const commitmentEvents = buildCommitmentEvents(commitments);

  // eslint-disable-next-line no-console
  console.log(
    `[quickSync/goldsky] from block ${fromBlock}: ${commitmentEvents.length} commitment batches, ${nullifierEvents.length} nullifiers, ${unshieldEvents.length} unshields`,
  );

  return {
    commitmentEvents,
    unshieldEvents,
    nullifierEvents,
  } as AccumulatedEvents;
};
