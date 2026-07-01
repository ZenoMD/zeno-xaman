import {
  WakuBroadcasterClient,
  BroadcasterTransaction,
} from "@railgun-community/waku-broadcaster-client-web";
import {
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
  calculateBroadcasterFeeERC20Amount,
  getFallbackProviderForNetwork,
} from "@railgun-community/wallet";
import {
  EVMGasType,
  TXIDVersion,
  getEVMGasTypeForTransaction,
  calculateGasPrice,
  NETWORK_CONFIG,
  type Chain,
  type NetworkName,
  type TransactionGasDetails,
  type FeeTokenDetails,
  type SelectedBroadcaster,
  type RailgunERC20AmountRecipient,
} from "@railgun-community/shared-models";
import type { LogFn } from "./types";

const TXID = TXIDVersion.V2_PoseidonMerkle;

const NODE_MULTIADDR =
  "/dns4/broadcaster-nwaku.fly.dev/tcp/443/wss/p2p/16Uiu2HAmS2pghMxhmS3gdhvZD15LY2BCPk6gxKSLGpJUgTkZx8Sc";

export const BROADCASTER_CONFIG = {
  // Content-topic namespace the broadcaster publishes fees / listens for
  // transactions under (`/<contentTopicApp>/v2/...`).
  contentTopicApp: "railgun-xrpl",

  // Address that signs fee messages. When empty the client trusts any fee it
  // sees (no signer check) — fine here since we don't use Private POI. Set to
  // the broadcaster's fee-signer address to re-enable verification.
  trustedFeeSigner: "",

  // Peers the client dials directly for filter/lightpush (live fees + submit).
  additionalDirectPeers: [NODE_MULTIADDR],

  // Nodes the client runs store queries against (the "Polling historical
  // messages" fee lookup). MUST point at our node — otherwise it defaults to the
  // public RAILGUN peers, which know nothing about `railgun-xrpl` fees. The node
  // must also have `store=true` mounted to answer these queries.
  storePeers: [NODE_MULTIADDR],

  // Waku pubsub shard the client subscribes on (`/waku/2/rs/<clusterId>/<shardId>`).
  // RAILGUN defaults to cluster 5 / shard 1, but our nwaku node relays cluster 0
  // (shards 0–5), so all three — node, broadcaster, and client — MUST agree on
  // the same cluster+shard or fee messages never route. `shardId` must be the
  // shard the broadcaster actually publishes fees on.
  clusterId: 0,
  shardId: 1,

  // The custom node is the only peer source, so skip public DNS discovery.
  useDNSDiscovery: false,
};

let startPromise: Promise<void> | undefined; // start the Waku client at most once per session

const chainForNetwork = (networkName: NetworkName): Chain =>
  NETWORK_CONFIG[networkName].chain;

/**
 * Connect to the broadcaster Waku network (idempotent). Resolves once the
 * client is started; broadcaster fee messages then arrive asynchronously.
 */
export function startBroadcasterClient(
  networkName: NetworkName,
  log: LogFn = console.log,
): Promise<void> {
  if (startPromise) return startPromise;

  const chain = chainForNetwork(networkName);

  const statusCallback = (_chain: unknown, status: string) => {
    log(`broadcaster: ${status}`);
  };

  startPromise = WakuBroadcasterClient.start(
    chain,
    {
      trustedFeeSigner: BROADCASTER_CONFIG.trustedFeeSigner,
      contentTopicApp: BROADCASTER_CONFIG.contentTopicApp,
      additionalDirectPeers: BROADCASTER_CONFIG.additionalDirectPeers,
      storePeers: BROADCASTER_CONFIG.storePeers,
      clusterId: BROADCASTER_CONFIG.clusterId,
      shardId: BROADCASTER_CONFIG.shardId,
      useDNSDiscovery: BROADCASTER_CONFIG.useDNSDiscovery,
    },
    statusCallback,
    { log, error: (e: Error) => log(`broadcaster error: ${e.message}`) },
  ).catch((e) => {
    startPromise = undefined; // allow a later retry
    throw e;
  });

  return startPromise;
}

/**
 * Disconnect the broadcaster Waku client and reset the session guard so a later
 * transfer can reconnect. Safe to call when not started; errors are swallowed
 * (the transfer that triggered this has already succeeded).
 */
export async function stopBroadcasterClient(
  log: LogFn = console.log,
): Promise<void> {
  if (!startPromise) return;
  startPromise = undefined;
  try {
    await WakuBroadcasterClient.stop();
    log("broadcaster: disconnected");
  } catch (e) {
    log(`broadcaster stop error: ${(e as Error).message}`);
  }
}

// Poll for a broadcaster willing to accept `tokenAddress` as its fee token.
// Fees arrive over Waku after connecting, so this isn't available immediately.
async function waitForBroadcaster(
  chain: Chain,
  tokenAddress: string,
  log: LogFn,
  timeoutMs = 45000,
): Promise<SelectedBroadcaster> {
  const useRelayAdapt = false;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const best = WakuBroadcasterClient.findBestBroadcaster(
      chain,
      tokenAddress,
      useRelayAdapt,
    );
    if (best) return best;
    if (Date.now() > deadline) {
      throw new Error(
        "No broadcaster found for the fee token (timed out waiting for fees)",
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
    log("waiting for a broadcaster…");
  }
}

// Current EIP-1559 fee data for the network, as Type2 gas details (XRPL EVM is
// Type2). gasEstimate is filled in after the estimate call.
async function fetchGasDetails(
  networkName: NetworkName,
): Promise<TransactionGasDetails> {
  const evmGasType = getEVMGasTypeForTransaction(networkName, false);
  const provider = getFallbackProviderForNetwork(networkName);
  const feeData = await provider.getFeeData();

  if (evmGasType === EVMGasType.Type2) {
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 1_000_000_000n;
    const maxFeePerGas =
      feeData.maxFeePerGas ??
      (feeData.gasPrice ?? 1_000_000_000n) + maxPriorityFeePerGas;
    return { evmGasType, gasEstimate: 0n, maxFeePerGas, maxPriorityFeePerGas };
  }
  return {
    evmGasType,
    gasEstimate: 0n,
    gasPrice: feeData.gasPrice ?? 1_000_000_000n,
  } as TransactionGasDetails;
}

export type TransferViaBroadcasterParams = {
  networkName: NetworkName;
  railgunWalletID: string;
  encryptionKey: string;
  /** 0zk recipient */
  recipientAddress: string;
  /** shielded ERC20 (also the fee token) */
  tokenAddress: string;
  /** amount in base units */
  amount: bigint;
  /** optional private memo */
  memoText?: string;
};

/**
 * Private (shielded) transfer via a RAILGUN broadcaster. Estimates the fee,
 * proves the transfer in-WebView, then hands the proved `transact` calldata to
 * the broadcaster over Waku — the broadcaster submits it on XRPL EVM and takes
 * its fee from the shielded amount. Nothing touches XRPL / Xaman.
 */
export async function transferViaBroadcaster(
  {
    networkName,
    railgunWalletID,
    encryptionKey,
    recipientAddress,
    tokenAddress,
    amount,
    memoText,
  }: TransferViaBroadcasterParams,
  log: LogFn = console.log,
  onProgress: (pct: number) => void = () => {},
): Promise<{ txHash: string }> {
  if (!recipientAddress?.startsWith("0zk")) {
    throw new Error("Recipient must be a 0zk RAILGUN address");
  }

  const chain = chainForNetwork(networkName);
  const sendWithPublicWallet = false; // a broadcaster submits it, not us
  const useRelayAdapt = false; // plain transfer, no RelayAdapt

  await startBroadcasterClient(networkName, log);

  log("Finding a broadcaster…");
  const broadcaster = await waitForBroadcaster(chain, tokenAddress, log);
  log(`Broadcaster ${broadcaster.railgunAddress.slice(0, 12)}… selected`);

  const feeTokenDetails: FeeTokenDetails = {
    tokenAddress,
    feePerUnitGas: BigInt(broadcaster.tokenFee.feePerUnitGas),
  };

  const erc20AmountRecipients: RailgunERC20AmountRecipient[] = [
    { tokenAddress, amount, recipientAddress },
  ];

  // 1) Estimate gas (iterates to account for the broadcaster fee it will pay).
  log("Estimating gas…");
  const originalGasDetails = await fetchGasDetails(networkName);
  const { gasEstimate } = await gasEstimateForUnprovenTransfer(
    TXID,
    networkName,
    railgunWalletID,
    encryptionKey,
    memoText,
    erc20AmountRecipients,
    [], // no NFTs
    originalGasDetails,
    feeTokenDetails,
    sendWithPublicWallet,
  );

  const gasDetails = {
    ...originalGasDetails,
    gasEstimate,
  } as TransactionGasDetails;
  const overallBatchMinGasPrice = calculateGasPrice(gasDetails);

  // 2) Broadcaster fee (in the shielded token), paid to its 0zk address.
  const broadcasterFeeERC20Amount = calculateBroadcasterFeeERC20Amount(
    feeTokenDetails,
    gasDetails,
  );
  const broadcasterFeeERC20AmountRecipient: RailgunERC20AmountRecipient = {
    ...broadcasterFeeERC20Amount,
    recipientAddress: broadcaster.railgunAddress,
  };

  // 3) Prove the transfer (heavy snarkjs work, single-threaded in the WebView).
  log("Generating transfer proof…");
  const showSenderAddressToRecipient = false;
  await generateTransferProof(
    TXID,
    networkName,
    railgunWalletID,
    encryptionKey,
    showSenderAddressToRecipient,
    memoText,
    erc20AmountRecipients,
    [],
    broadcasterFeeERC20AmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    (pct: number) => onProgress(pct || 0),
  );

  const { transaction, nullifiers, preTransactionPOIsPerTxidLeafPerList } =
    await populateProvedTransfer(
      TXID,
      networkName,
      railgunWalletID,
      showSenderAddressToRecipient,
      memoText,
      erc20AmountRecipients,
      [],
      broadcasterFeeERC20AmountRecipient,
      sendWithPublicWallet,
      overallBatchMinGasPrice,
      gasDetails,
    );

  // 4) Hand the proved calldata to the broadcaster over Waku.
  log("Submitting to broadcaster…");
  const broadcasterTransaction = await BroadcasterTransaction.create(
    TXID,
    transaction.to as string,
    transaction.data,
    broadcaster.railgunAddress,
    broadcaster.tokenFee.feesID,
    chain,
    nullifiers ?? [],
    overallBatchMinGasPrice,
    useRelayAdapt,
    preTransactionPOIsPerTxidLeafPerList,
  );

  const txHash = await broadcasterTransaction.send();
  log(`Broadcaster submitted → ${txHash}`);

  // Transfer done — tear down the Waku connection (a later transfer reconnects).
  await stopBroadcasterClient(log);

  return { txHash };
}
