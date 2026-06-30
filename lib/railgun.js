import {
  startRailgunEngine,
  loadProvider,
  createRailgunWallet,
  getProver,
  refreshBalances,
  setOnBalanceUpdateCallback,
} from '@railgun-community/wallet';
import { NetworkName, NETWORK_CONFIG, ChainType, EVMGasType, TXIDVersion } from '@railgun-community/shared-models';
import { POI } from '@railgun-community/engine';
import * as snarkjs from 'snarkjs';

const POI_NODE_URLS = ['https://poi.railgun.org'];
const TXID = TXIDVersion.V2_PoseidonMerkle;

// --- XRPL EVM mainnet ----------------------------------------------------
// Not a built-in RAILGUN network, so register it. The engine resolves all
// contract addresses via NETWORK_CONFIG[networkName] and reverse-maps a chain
// back to its network with networkForChain (which scans NETWORK_CONFIG by
// chain.id) — both are plain mutable objects, so adding an entry is enough.
//
// Contracts are from our deployment (railgun-deployment.js); deploymentBlock is
// the block the proxy first had code (queried from the RPC).
export const XRPL_EVM_NETWORK = 'XRPL_EVM';
NetworkName.XRPLEVM = XRPL_EVM_NETWORK;
NETWORK_CONFIG[XRPL_EVM_NETWORK] = {
  chain: { type: ChainType.EVM, id: 1440000 },
  name: XRPL_EVM_NETWORK,
  publicName: 'XRPL EVM',
  shortPublicName: 'XRPL EVM',
  coingeckoId: 'ripple',
  baseToken: {
    symbol: 'XRP',
    wrappedSymbol: 'WXRP',
    wrappedAddress: '0x7C21a90E3eCD3215d16c3BBe76a491f8f792d4Bf',
    decimals: 18,
  },
  proxyContract: '0x83f2630F50eF954927e97E2246b4F7dCEa8c02EA',
  relayAdaptContract: '0x4d1e1aB8FD7BB2D161e164f5D52E694e17FF0465',
  relayAdaptHistory: ['0x4d1e1aB8FD7BB2D161e164f5D52E694e17FF0465'],
  railgunRegistryContract: '',
  deploymentBlock: 6552860,
  isTestnet: false,
  defaultEVMGasType: EVMGasType.Type2, // XRPL EVM supports EIP-1559
  supportsV3: false,
};
// -------------------------------------------------------------------------

// Wrapped-native token addresses (what shielding the native gas token gives you).
export const WETH_ADDRESS = {
  [NetworkName.EthereumSepolia]: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  [NetworkName.Ethereum]: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  // Native XRP on XRPL EVM (canonical native-asset sentinel) — the token the
  // Axelar bridge shields. Mirrors baseToken.wrappedAddress / BRIDGED_TOKEN_ADDRESS.
  [XRPL_EVM_NETWORK]: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
};

const NETWORKS = {
  [NetworkName.EthereumSepolia]: {
    chainId: 11155111,
    providers: [
      { provider: 'https://ethereum-sepolia-rpc.publicnode.com', priority: 1, weight: 1 },
      { provider: 'https://1rpc.io/sepolia', priority: 2, weight: 1 },
    ],
  },
  [NetworkName.Ethereum]: {
    chainId: 1,
    providers: [
      { provider: 'https://ethereum-rpc.publicnode.com', priority: 1, weight: 1 },
      { provider: 'https://eth.drpc.org', priority: 2, weight: 1 },
    ],
  },
  [XRPL_EVM_NETWORK]: {
    chainId: 1440000,
    // Only one public RPC, so weight 2 to clear the fallback quorum (the engine
    // requires total provider weight >= 2).
    providers: [
      { provider: 'https://rpc.xrplevm.org', priority: 1, weight: 2 },
    ],
  },
};

// Force singleThread proving + minimal witness memory so snarkjs runs inside the
// Xaman WebView, which can't spawn snarkjs's nested worker threads. RAILGUN's
// prover only passes 4 args to fullProve; we inject the 5th (wtns options) and
// 6th (prover options).
const webviewGroth16 = {
  fullProve: (input, wasm, zkey, logger) =>
    snarkjs.groth16.fullProve(input, wasm, zkey, logger, { memorySize: 0 }, { singleThread: true }),
  prove: (zkey, wtns, logger) => snarkjs.groth16.prove(zkey, wtns, logger, { singleThread: true }),
  verify: snarkjs.groth16.verify,
};

// Latest shielded ERC20 balances captured from the scan, keyed by
// `${bucket}:${lowercasedToken}` (a token can appear in several POI buckets).
const balances = new Map();

// Largest balance seen for a token across ALL buckets — finds funds even when
// they're not yet in the Spendable bucket (e.g. MissingExternalPOI).
export const getShieldedBalance = (tokenAddress) => {
  const t = tokenAddress.toLowerCase();
  let max = 0n;
  for (const [k, v] of balances) if (k.endsWith(`:${t}`) && v > max) max = v;
  return max;
};

/**
 * Initialize a RAILGUN wallet client-side on the given network (default Sepolia).
 * @returns { wallet, networkName }
 */
export async function initRailgun(
  db,
  artifactStore,
  { mnemonic, encryptionKey, networkName = NetworkName.EthereumSepolia },
  log = console.log,
) {
  log('Starting RAILGUN engine…');
  await startRailgunEngine('zenoxaman', db, false, artifactStore, false, false, POI_NODE_URLS);

  // Hand the prover our WebView-safe (singleThread) groth16 implementation.
  getProver().setSnarkJSGroth16(webviewGroth16);
  // Treat all proofs as valid regardless of POI status
  POI.isRequiredForChain = () => false;

  setOnBalanceUpdateCallback((e) => {
    for (const { tokenAddress, amount } of e.erc20Amounts) {
      balances.set(`${e.balanceBucket}:${tokenAddress.toLowerCase()}`, amount);
      if (amount > 0n) log(`balance [${e.balanceBucket}] ${tokenAddress.slice(0, 10)}…: ${amount}`);
    }
  });

  const net = NETWORKS[networkName];
  log(`Loading provider (${networkName})…`);
  await loadProvider({ chainId: net.chainId, providers: net.providers }, networkName, 15000);

  log('Creating RAILGUN wallet…');
  const wallet = await createRailgunWallet(encryptionKey, mnemonic, undefined);
  log(`Wallet ready: ${wallet.railgunAddress}`);

  // Background scan — finds shielded UTXOs that become the proof inputs.
  const { chain } = NETWORK_CONFIG[networkName];
  refreshBalances(chain, [wallet.id]).catch((e) => log(`scan error: ${e.message}`));

  return { wallet, networkName };
}
