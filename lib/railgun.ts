import {
  startRailgunEngine,
  loadProvider,
  createRailgunWallet,
  getProver,
  refreshBalances,
  setOnBalanceUpdateCallback,
  setOnUTXOMerkletreeScanCallback,
  type ArtifactStore,
} from "@railgun-community/wallet";
import {
  NetworkName,
  NETWORK_CONFIG,
  ChainType,
  EVMGasType,
  TXIDVersion,
  type MerkletreeScanUpdateEvent,
} from "@railgun-community/shared-models";
import { POI } from "@railgun-community/engine";
import * as snarkjs from "snarkjs";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import type { SqliteLevelDown } from "./sqlite/leveldown";
import type { LogFn } from "./types";

type RailgunWallet = Awaited<ReturnType<typeof createRailgunWallet>>;

const POI_NODE_URLS = ["https://poi.railgun.org"];
const TXID = TXIDVersion.V2_PoseidonMerkle;

export const XRPL_EVM_NETWORK = "XRPL_EVM" as NetworkName;
(NetworkName as Record<string, string>).XRPLEVM = XRPL_EVM_NETWORK;
(NETWORK_CONFIG as Record<string, unknown>)[XRPL_EVM_NETWORK] = {
  chain: { type: ChainType.EVM, id: 1440000 },
  name: XRPL_EVM_NETWORK,
  publicName: "XRPL EVM",
  shortPublicName: "XRPL EVM",
  coingeckoId: "ripple",
  baseToken: {
    symbol: "XRP",
    wrappedSymbol: "WXRP",
    wrappedAddress: "0x7C21a90E3eCD3215d16c3BBe76a491f8f792d4Bf",
    decimals: 18,
  },
  proxyContract: "0x83f2630F50eF954927e97E2246b4F7dCEa8c02EA",
  relayAdaptContract: "0x4d1e1aB8FD7BB2D161e164f5D52E694e17FF0465",
  relayAdaptHistory: ["0x4d1e1aB8FD7BB2D161e164f5D52E694e17FF0465"],
  railgunRegistryContract: "",
  deploymentBlock: 6552860,
  isTestnet: false,
  defaultEVMGasType: EVMGasType.Type2, // XRPL EVM supports EIP-1559
  supportsV3: false,
};

// Wrapped-native token addresses (what shielding the native gas token gives you).
export const WETH_ADDRESS: Record<string, string> = {
  [NetworkName.EthereumSepolia]: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  [NetworkName.Ethereum]: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  // Native XRP on XRPL EVM (canonical native-asset sentinel) — the token the
  // Axelar bridge shields. Mirrors baseToken.wrappedAddress / BRIDGED_TOKEN_ADDRESS.
  [XRPL_EVM_NETWORK]: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
};

type ProviderConfig = { provider: string; priority: number; weight: number };
type NetworkProviders = { chainId: number; providers: ProviderConfig[] };

const NETWORKS: Record<string, NetworkProviders> = {
  [NetworkName.EthereumSepolia]: {
    chainId: 11155111,
    providers: [
      {
        provider: "https://ethereum-sepolia-rpc.publicnode.com",
        priority: 1,
        weight: 1,
      },
      { provider: "https://1rpc.io/sepolia", priority: 2, weight: 1 },
    ],
  },
  [NetworkName.Ethereum]: {
    chainId: 1,
    providers: [
      {
        provider: "https://ethereum-rpc.publicnode.com",
        priority: 1,
        weight: 1,
      },
      { provider: "https://eth.drpc.org", priority: 2, weight: 1 },
    ],
  },
  [XRPL_EVM_NETWORK]: {
    chainId: 1440000,
    // Only one public RPC, so weight 2 to clear the fallback quorum (the engine
    // requires total provider weight >= 2).
    providers: [
      {
        provider: "https://json-rpc.xrpl.cumulo.org.es",
        priority: 1,
        weight: 2,
      },
    ],
  },
};

// Force singleThread proving + minimal witness memory so snarkjs runs inside the
// Xaman WebView, which can't spawn snarkjs's nested worker threads. RAILGUN's
// prover only passes 4 args to fullProve; we inject the 5th (wtns options) and
// 6th (prover options).
const webviewGroth16 = {
  fullProve: (input: unknown, wasm: unknown, zkey: unknown, logger: unknown) =>
    snarkjs.groth16.fullProve(
      input,
      wasm,
      zkey,
      logger,
      { memorySize: 0 },
      { singleThread: true },
    ),
  prove: (zkey: unknown, wtns: unknown, logger: unknown) =>
    snarkjs.groth16.prove(zkey, wtns, logger, { singleThread: true }),
  verify: snarkjs.groth16.verify,
};

// Latest shielded ERC20 balances captured from the scan, keyed by
// `${bucket}:${lowercasedToken}` (a token can appear in several POI buckets).
const balances = new Map<string, bigint>();

// Largest balance seen for a token across ALL buckets — finds funds even when
// they're not yet in the Spendable bucket (e.g. MissingExternalPOI).
export const getShieldedBalance = (tokenAddress: string): bigint => {
  const t = tokenAddress.toLowerCase();
  let max = 0n;
  for (const [k, v] of balances) if (k.endsWith(`:${t}`) && v > max) max = v;
  return max;
};

// Every shielded token with a positive balance (largest across buckets), keyed
// by lowercased address. Backs the Transfer tab's token picker.
export const getShieldedTokens = (): {
  tokenAddress: string;
  amount: bigint;
}[] => {
  const maxByToken = new Map<string, bigint>();
  for (const [k, v] of balances) {
    const tokenAddress = k.slice(k.indexOf(":") + 1);
    if (v > (maxByToken.get(tokenAddress) ?? 0n))
      maxByToken.set(tokenAddress, v);
  }
  return [...maxByToken]
    .filter(([, amount]) => amount > 0n)
    .map(([tokenAddress, amount]) => ({ tokenAddress, amount }));
};

// --- Shielded-token metadata (for the multi-token balance card) -------------

const ERC20_META_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// symbol/decimals are immutable, so cache per address for the session.
const tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();
let metaProvider: JsonRpcProvider | undefined;

const getMetaProvider = (networkName: string): JsonRpcProvider =>
  (metaProvider ??= new JsonRpcProvider(
    NETWORKS[networkName].providers[0].provider,
    undefined,
    { staticNetwork: true },
  ));

/**
 * Resolve an ERC20's { symbol, decimals } for labelling shielded balances. The
 * wrapped-native sentinel reports as XRP; if the on-chain read fails the token
 * falls back to a shortened address and 18 decimals.
 */
export async function resolveTokenMeta(
  tokenAddress: string,
  networkName: string,
): Promise<{ symbol: string; decimals: number }> {
  const key = tokenAddress.toLowerCase();
  const cached = tokenMetaCache.get(key);
  if (cached) return cached;

  const wrapped = (
    (NETWORK_CONFIG as Record<string, { baseToken?: { wrappedAddress?: string } }>)[
      networkName
    ]
  )?.baseToken?.wrappedAddress?.toLowerCase();

  let meta: { symbol: string; decimals: number };
  if (key === WETH_ADDRESS[networkName]?.toLowerCase() || key === wrapped) {
    meta = { symbol: "XRP", decimals: 18 };
  } else {
    try {
      const erc20 = new Contract(
        tokenAddress,
        ERC20_META_ABI,
        getMetaProvider(networkName),
      );
      const [symbol, decimals] = await Promise.all([
        erc20.symbol(),
        erc20.decimals(),
      ]);
      meta = { symbol: String(symbol), decimals: Number(decimals) };
    } catch {
      meta = {
        symbol: `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`,
        decimals: 18,
      };
    }
  }
  tokenMetaCache.set(key, meta);
  return meta;
}

/**
 * Every shielded token with a positive balance, decorated with its symbol and
 * human-formatted amount (scaled by the token's own decimals). Backs the
 * multi-token balance card.
 */
export async function getShieldedBalances(
  networkName: string,
): Promise<{ address: string; symbol: string; formatted: string }[]> {
  return Promise.all(
    getShieldedTokens().map(async ({ tokenAddress, amount }) => {
      const { symbol, decimals } = await resolveTokenMeta(
        tokenAddress,
        networkName,
      );
      return {
        address: tokenAddress,
        symbol,
        formatted: formatUnits(amount, decimals),
      };
    }),
  );
}

/**
 * Initialize a RAILGUN wallet client-side on the given network (default Sepolia).
 */
export async function initRailgun(
  db: SqliteLevelDown,
  artifactStore: ArtifactStore,
  {
    mnemonic,
    encryptionKey,
    networkName = NetworkName.EthereumSepolia,
    onScanUpdate,
    onBalanceUpdate,
  }: {
    mnemonic: string;
    encryptionKey: string;
    networkName?: NetworkName;
    /** Fired as the shielded UTXO merkletree scan progresses/completes. */
    onScanUpdate?: (event: MerkletreeScanUpdateEvent) => void;
    /**
     * Fired once the wallet's shielded balances have actually been computed
     * (fires after the merkletree scan, even for an empty wallet). This — not
     * scan-complete — is when a displayed balance is trustworthy.
     */
    onBalanceUpdate?: () => void;
  },
  log: LogFn = console.log,
): Promise<{ wallet: RailgunWallet; networkName: NetworkName }> {
  log("Starting RAILGUN engine…");
  await startRailgunEngine(
    "zenoxaman",
    db as any,
    false,
    artifactStore,
    false,
    false,
    POI_NODE_URLS,
  );

  // Hand the prover our WebView-safe (singleThread) groth16 implementation.
  getProver().setSnarkJSGroth16(webviewGroth16 as any);
  // Treat all proofs as valid regardless of POI status
  (POI as any).isRequiredForChain = () => false;

  setOnBalanceUpdateCallback((e) => {
    for (const { tokenAddress, amount } of e.erc20Amounts) {
      balances.set(`${e.balanceBucket}:${tokenAddress.toLowerCase()}`, amount);
      if (amount > 0n)
        log(
          `balance [${e.balanceBucket}] ${tokenAddress.slice(0, 10)}…: ${amount}`,
        );
    }
    // Balances are now computed (even if empty) — safe to reveal.
    onBalanceUpdate?.();
  });

  // Forward shielded-UTXO scan progress so the UI can hold off on showing a
  // (misleading) zero balance until the merkletree is fully synced.
  if (onScanUpdate) {
    setOnUTXOMerkletreeScanCallback((event) => {
      log(`scan [${event.scanStatus}] ${Math.round(event.progress * 100)}%`);
      onScanUpdate(event);
    });
  }

  const net = NETWORKS[networkName];
  log(`Loading provider (${networkName})…`);
  await loadProvider(
    { chainId: net.chainId, providers: net.providers },
    networkName,
    15000,
  );

  log("Creating RAILGUN wallet…");
  const wallet = await createRailgunWallet(encryptionKey, mnemonic, undefined);
  log(`Wallet ready: ${wallet.railgunAddress}`);

  // Background scan — finds shielded UTXOs that become the proof inputs.
  const { chain } = NETWORK_CONFIG[networkName];
  refreshBalances(chain, [wallet.id]).catch((e: Error) =>
    log(`scan error: ${e.message}`),
  );

  return { wallet, networkName };
}
