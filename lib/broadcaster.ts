import {
  WakuBroadcasterClient,
  BroadcasterTransaction,
} from "@railgun-community/waku-broadcaster-client-web";
import {
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
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
  type RailgunERC20Amount,
  type RailgunERC20Recipient,
  type RailgunERC20AmountRecipient,
} from "@railgun-community/shared-models";
import { buildUnshieldCrossContractCalls, RETURN_GAS_VALUE } from "./its";
import { feeFromValue, getPoolFeeBasisPoints } from "./pool-fees";
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

// How long a submission waits for a broadcaster's fee message to arrive over
// Waku. A fee quote passes something much shorter — it would rather come back
// incomplete than block the form.
export const BROADCASTER_WAIT_MS = 45000;

// Each probe is a synchronous read of the client's fee cache, so polling costs
// nothing and a fine interval just means a fee is noticed sooner after it lands.
const BROADCASTER_POLL_MS = 500;

// Poll for a broadcaster willing to accept `tokenAddress` as its fee token.
// Fees arrive over Waku after connecting, so this isn't available immediately.
async function waitForBroadcaster(
  chain: Chain,
  tokenAddress: string,
  useRelayAdapt: boolean,
  log: LogFn,
  timeoutMs = BROADCASTER_WAIT_MS,
): Promise<SelectedBroadcaster> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const best = WakuBroadcasterClient.findBestBroadcaster(
      chain,
      tokenAddress,
      useRelayAdapt,
    );
    if (best) return best;
    // Stop when the next probe would land past the deadline, so the wait never
    // runs over the budget its caller set. Checking after the sleep instead used
    // to overshoot by a full interval, and a quote that asked for 4s got 6s.
    if (Date.now() + BROADCASTER_POLL_MS > deadline) {
      throw new Error(
        "No broadcaster found for the fee token (timed out waiting for fees)",
      );
    }
    await new Promise((r) => setTimeout(r, BROADCASTER_POLL_MS));
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
  /**
   * How long to wait for a broadcaster's fee message. Defaults to the
   * submission wait; a fee quote passes a short one so the form isn't blocked.
   */
  broadcasterWaitMs?: number;
};

/**
 * Everything priced before a proof is generated: the selected broadcaster, the
 * gas details its fee is derived from, and the fee itself. Produced once and
 * used by both the fee quote and the transaction it quotes, so the two can never
 * disagree.
 */
export type BroadcasterFeeQuote = {
  broadcaster: SelectedBroadcaster;
  feeTokenDetails: FeeTokenDetails;
  /** Gas details with `gasEstimate` filled in — what the fee is computed from. */
  gasDetails: TransactionGasDetails;
  overallBatchMinGasPrice: bigint;
  /** EVM gas the broadcaster charges, in fee-token base units. */
  gasFee: bigint;
  /** Everything the broadcaster is paid, in fee-token base units. */
  totalFee: bigint;
  /** The fee as an addressed output to the broadcaster's 0zk address. */
  feeRecipient: RailgunERC20AmountRecipient;
};

/**
 * Select a broadcaster and price a private transfer: gas estimate + the fee that
 * broadcaster charges for it, in the transferred token. Everything up to (but
 * not including) proof generation, so a quote costs no snarkjs work.
 */
export async function prepareTransfer(
  {
    networkName,
    railgunWalletID,
    encryptionKey,
    recipientAddress,
    tokenAddress,
    amount,
    memoText,
    broadcasterWaitMs,
  }: TransferViaBroadcasterParams,
  log: LogFn = console.log,
): Promise<
  BroadcasterFeeQuote & {
    erc20AmountRecipients: RailgunERC20AmountRecipient[];
  }
> {
  if (!recipientAddress?.startsWith("0zk")) {
    throw new Error("Recipient must be a 0zk RAILGUN address");
  }

  const chain = chainForNetwork(networkName);
  const sendWithPublicWallet = false; // a broadcaster submits it, not us
  const useRelayAdapt = false; // plain transfer, no RelayAdapt

  await startBroadcasterClient(networkName, log);

  log("Finding a broadcaster…");
  const broadcaster = await waitForBroadcaster(
    chain,
    tokenAddress,
    useRelayAdapt,
    log,
    broadcasterWaitMs,
  );
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

  // 2) Broadcaster fee (in the shielded token), paid to its 0zk address. It is
  //    an extra output, so the recipient still receives the full `amount`.
  const broadcasterFeeERC20Amount = calculateBroadcasterFeeERC20Amount(
    feeTokenDetails,
    gasDetails,
  );
  const feeRecipient: RailgunERC20AmountRecipient = {
    ...broadcasterFeeERC20Amount,
    recipientAddress: broadcaster.railgunAddress,
  };

  return {
    broadcaster,
    feeTokenDetails,
    gasDetails,
    overallBatchMinGasPrice,
    gasFee: broadcasterFeeERC20Amount.amount,
    totalFee: broadcasterFeeERC20Amount.amount,
    feeRecipient,
    erc20AmountRecipients,
  };
}

/**
 * Private (shielded) transfer via a RAILGUN broadcaster. Estimates the fee,
 * proves the transfer in-WebView, then hands the proved `transact` calldata to
 * the broadcaster over Waku — the broadcaster submits it on XRPL EVM and takes
 * its fee from the shielded amount. Nothing touches XRPL / Xaman.
 */
export async function transferViaBroadcaster(
  params: TransferViaBroadcasterParams,
  log: LogFn = console.log,
  onProgress: (pct: number) => void = () => {},
): Promise<{ txHash: string }> {
  const { networkName, railgunWalletID, encryptionKey, memoText } = params;
  const chain = chainForNetwork(networkName);
  const sendWithPublicWallet = false; // a broadcaster submits it, not us
  const useRelayAdapt = false; // plain transfer, no RelayAdapt

  // 1) + 2) Broadcaster, gas estimate and fee — the same call the fee quote makes.
  const {
    broadcaster,
    gasDetails,
    overallBatchMinGasPrice,
    feeRecipient: broadcasterFeeERC20AmountRecipient,
    erc20AmountRecipients,
  } = await prepareTransfer(params, log);

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

// Minimum gas forwarded to the RelayAdapt cross-contract calls so the nested
// ITS interchainTransfer can't run out mid-call. RAILGUN's recommended floor.
const RELAY_ADAPT_MIN_GAS_LIMIT = 2_800_000n;

export type UnshieldViaBroadcasterParams = {
  networkName: NetworkName;
  railgunWalletID: string;
  encryptionKey: string;
  /** destination XRPL classic r-address (the account holder receiving funds) */
  xrplRecipient: string;
  /** shielded ERC20 to unshield (also the broadcaster fee token) */
  tokenAddress: string;
  /** amount in base units */
  amount: bigint;
  /**
   * How long to wait for a broadcaster's fee message. Defaults to the
   * submission wait; a fee quote passes a short one so the form isn't blocked.
   */
  broadcasterWaitMs?: number;
};

/** What `prepareUnshield` produces on top of the broadcaster fee. */
export type UnshieldPlan = BroadcasterFeeQuote & {
  /** Pool unshield fee, in the unshielded token's base units. */
  unshieldFee: bigint;
  /** What actually reaches XRPL: `amount - unshieldFee`. */
  bridgeAmount: bigint;
  /** Native XRP the broadcaster fronts for the return relay, reimbursed in the fee. */
  returnGasValue: bigint;
  relayAdaptUnshieldERC20Amounts: RailgunERC20Amount[];
  relayAdaptShieldERC20Recipients: RailgunERC20Recipient[];
  crossContractCalls: Parameters<
    typeof gasEstimateForUnprovenCrossContractCalls
  >[8];
};

/**
 * Select a broadcaster and price an unshield-to-XRPL: the pool's unshield fee,
 * the amount that survives it, the gas estimate for the RelayAdapt multicall and
 * the broadcaster's fee for submitting it. Everything up to (but not including)
 * proof generation, so a quote costs no snarkjs work.
 */
export async function prepareUnshield(
  {
    networkName,
    railgunWalletID,
    encryptionKey,
    xrplRecipient,
    tokenAddress,
    amount,
    broadcasterWaitMs,
  }: UnshieldViaBroadcasterParams,
  log: LogFn = console.log,
): Promise<UnshieldPlan> {
  const chain = chainForNetwork(networkName);
  const sendWithPublicWallet = false; // a broadcaster submits it, not us
  const useRelayAdapt = true; // unshield routes through the RelayAdapt contract

  await startBroadcasterClient(networkName, log);

  log("Finding a broadcaster…");
  const broadcaster = await waitForBroadcaster(
    chain,
    tokenAddress,
    useRelayAdapt,
    log,
    broadcasterWaitMs,
  );
  log(`Broadcaster ${broadcaster.railgunAddress.slice(0, 12)}… selected`);

  const feeTokenDetails: FeeTokenDetails = {
    tokenAddress,
    feePerUnitGas: BigInt(broadcaster.tokenFee.feePerUnitGas),
  };

  // Unshield the gross `amount` to the RelayAdapt contract; it holds the funds
  // for the duration of the cross-contract calls below. No re-shield afterwards.
  const relayAdaptUnshieldERC20Amounts: RailgunERC20Amount[] = [
    { tokenAddress, amount },
  ];
  const relayAdaptShieldERC20Recipients: RailgunERC20Recipient[] = [];

  // The pool deducts an unshield fee from every unshield, so the RelayAdapt only
  // ever receives `amount - fee`. The ITS transfer must bridge exactly what the
  // RelayAdapt will hold — bridging the gross `amount` over-requests and reverts
  // the interchainTransfer burn. Read the rate off the pool rather than
  // hardcoding it, so the quote and the transaction use the same number.
  const { unshield: unshieldFeeBasisPoints } =
    await getPoolFeeBasisPoints(networkName);
  const { amount: bridgeAmount, fee: unshieldFee } = feeFromValue(
    amount,
    unshieldFeeBasisPoints,
  );
  log(`Bridging ${bridgeAmount} of ${amount} (after unshield fee) → XRPL`);

  // The multicall the RelayAdapt runs while holding the unshielded funds: hand
  // them to the Axelar ITS to bridge back to the XRPL account holder. Cast to
  // the SDK's ContractTransaction[] — it bundles its own (older) ethers whose
  // type differs from ours only on EIP-7702 fields we never set.
  type CrossContractCalls = Parameters<
    typeof gasEstimateForUnprovenCrossContractCalls
  >[8];

  // Gas estimation simulates relay() with no msg.value and requireSuccess=true,
  // so the RelayAdapt has no native and a payable ITS sub-call would revert.
  // Estimate with call.value=0; the real gas value is bound only into the proof.
  const estimateCalls = buildUnshieldCrossContractCalls({
    amount: bridgeAmount,
    xrplRecipient,
    gasValue: 0n,
  }) as unknown as CrossContractCalls;

  // Proof + populate bind the real call.value; the broadcaster funds the
  // RelayAdapt with (at least) that much native as msg.value when submitting.
  const crossContractCalls = buildUnshieldCrossContractCalls({
    amount: bridgeAmount,
    xrplRecipient,
  }) as unknown as CrossContractCalls;

  // 1) Estimate gas (iterates to account for the broadcaster fee it will pay).
  log("Estimating gas…");
  const originalGasDetails = await fetchGasDetails(networkName);
  const { gasEstimate } = await gasEstimateForUnprovenCrossContractCalls(
    TXID,
    networkName,
    railgunWalletID,
    encryptionKey,
    relayAdaptUnshieldERC20Amounts,
    [], // no NFTs to unshield
    relayAdaptShieldERC20Recipients,
    [], // no NFTs to re-shield
    estimateCalls,
    originalGasDetails,
    feeTokenDetails,
    sendWithPublicWallet,
    RELAY_ADAPT_MIN_GAS_LIMIT,
  ).catch((err: unknown) => {
    // "RelayAdapt multicall failed at index N" hides the real sub-call revert in
    // err.cause — surface it so ITS failures (bad chain/tokenId, gas, balance)
    // are diagnosable instead of opaque.
    const cause = (err as { cause?: Error }).cause;
    if (cause?.message) log(`revert reason (call): ${cause.message}`);
    throw err;
  });

  const gasDetails = {
    ...originalGasDetails,
    gasEstimate,
  } as TransactionGasDetails;
  const overallBatchMinGasPrice = calculateGasPrice(gasDetails);

  // 2) Broadcaster fee (in the shielded token), paid to its 0zk address. On top
  //    of the quoted EVM gas fee, reimburse the broadcaster for the native XRP it
  //    fronts as msg.value on the relay() call (Axelar cross-chain gas). The fee
  //    token is XRP (18 dp), so RETURN_GAS_VALUE converts 1:1 to fee-token units.
  const broadcasterFeeERC20Amount = calculateBroadcasterFeeERC20Amount(
    feeTokenDetails,
    gasDetails,
  );
  const feeRecipient: RailgunERC20AmountRecipient = {
    tokenAddress: broadcasterFeeERC20Amount.tokenAddress,
    amount: broadcasterFeeERC20Amount.amount + RETURN_GAS_VALUE,
    recipientAddress: broadcaster.railgunAddress,
  };

  return {
    broadcaster,
    feeTokenDetails,
    gasDetails,
    overallBatchMinGasPrice,
    gasFee: broadcasterFeeERC20Amount.amount,
    totalFee: feeRecipient.amount,
    feeRecipient,
    unshieldFee,
    bridgeAmount,
    returnGasValue: RETURN_GAS_VALUE,
    relayAdaptUnshieldERC20Amounts,
    relayAdaptShieldERC20Recipients,
    crossContractCalls,
  };
}

/**
 * Unshield to XRPL via a RAILGUN broadcaster + RelayAdapt cross-contract call.
 * Unshields `amount` from the pool into the RelayAdapt contract, which then runs
 * a multicall that hands the funds to the Axelar ITS to bridge back to the XRPL
 * account holder. The proof binds the RelayAdapt address (adaptAddress) and the
 * exact calls, so the broadcaster can only submit this transaction as-proved.
 * The broadcaster pays EVM gas and takes its fee from the shielded balance.
 */
export async function unshieldViaBroadcaster(
  params: UnshieldViaBroadcasterParams,
  log: LogFn = console.log,
  onProgress: (pct: number) => void = () => {},
): Promise<{ txHash: string }> {
  const { networkName, railgunWalletID, encryptionKey } = params;
  const chain = chainForNetwork(networkName);
  const sendWithPublicWallet = false; // a broadcaster submits it, not us
  const useRelayAdapt = true; // unshield routes through the RelayAdapt contract

  // 1) + 2) Broadcaster, gas estimate and fees — the same call the quote makes.
  const {
    broadcaster,
    gasDetails,
    overallBatchMinGasPrice,
    feeRecipient: broadcasterFeeERC20AmountRecipient,
    relayAdaptUnshieldERC20Amounts,
    relayAdaptShieldERC20Recipients,
    crossContractCalls,
  } = await prepareUnshield(params, log);

  // 3) Prove the cross-contract calls (heavy snarkjs work in the WebView). This
  //    binds the RelayAdapt adaptAddress + the exact calls into the proof.
  log("Generating unshield proof…");
  await generateCrossContractCallsProof(
    TXID,
    networkName,
    railgunWalletID,
    encryptionKey,
    relayAdaptUnshieldERC20Amounts,
    [],
    relayAdaptShieldERC20Recipients,
    [],
    crossContractCalls,
    broadcasterFeeERC20AmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    RELAY_ADAPT_MIN_GAS_LIMIT,
    (pct: number) => onProgress(pct || 0),
  );

  const { transaction, nullifiers, preTransactionPOIsPerTxidLeafPerList } =
    await populateProvedCrossContractCalls(
      TXID,
      networkName,
      railgunWalletID,
      relayAdaptUnshieldERC20Amounts,
      [],
      relayAdaptShieldERC20Recipients,
      [],
      crossContractCalls,
      broadcasterFeeERC20AmountRecipient,
      sendWithPublicWallet,
      overallBatchMinGasPrice,
      gasDetails,
    );

  // 4) Hand the proved calldata to the broadcaster over Waku (useRelayAdapt).
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

  // Unshield done — tear down the Waku connection (a later action reconnects).
  await stopBroadcasterClient(log);

  return { txHash };
}
