import {
  startRailgunEngine,
  loadProvider,
  createRailgunWallet,
  getProver,
  refreshBalances,
  setOnBalanceUpdateCallback,
} from '@railgun-community/wallet';
import { NetworkName, NETWORK_CONFIG, TXIDVersion } from '@railgun-community/shared-models';
import { POI } from '@railgun-community/engine';
import * as snarkjs from 'snarkjs';

const POI_NODE_URLS = ['https://poi.railgun.org'];
const TXID = TXIDVersion.V2_PoseidonMerkle;

// Wrapped-native token addresses (what shielding native ETH gives you).
export const WETH_ADDRESS = {
  [NetworkName.EthereumSepolia]: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  [NetworkName.Ethereum]: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
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
