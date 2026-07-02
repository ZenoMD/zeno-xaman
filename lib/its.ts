import { Interface, parseEther, type ContractTransaction } from "ethers";

// --- Axelar ITS deployment on XRPL EVM (fill in before enabling unshield) ---

// InterchainTokenService. Default is the mainnet ITS used by the fork test in
// contracts/test/AxelarPoolRouter.t.sol.
export const ITS_ADDRESS = "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C";

// The XRP interchain tokenId (bytes32) as registered with ITS. REQUIRED — the
// interchain transfer names the asset by id, not by ERC20 address.
export const XRP_TOKEN_ID =
  "0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f";

// XRP on XRPL EVM is a mint/burn interchain token, so ITS burns it straight
// from the RelayAdapt (msg.sender) — no allowance / TokenManager approval step.

// Axelar chain name for the XRPL mainnet (the return destination). The shield
// leg bridges to "xrpl-evm"; the unshield leg bridges back to "xrpl".
export const DESTINATION_CHAIN = "xrpl";

// Native XRP bound as call.value on the interchainTransfer to prepay Axelar's
// cross-chain (EVM→XRPL) relay gas. The RelayAdapt forwards this into the ITS
// call from its own balance; the broadcaster tops the RelayAdapt up by sending
// (at least) this much native as msg.value on the relay() call. Bound into the
// proof's adaptParams, so the broadcaster must supply exactly this much.
export const RETURN_GAS_VALUE = parseEther("0.01");

// The deployed XRPL-EVM ITS exposes only the 6-arg interchainTransfer (with
// metadata + gasValue); the 4-arg overload's selector isn't present and reverts
// immediately. metadata is empty (plain transfer); gasValue is the native paid
// to the Axelar gas service and must be ≤ msg.value.
const itsInterface = new Interface([
  "function interchainTransfer(bytes32 tokenId, string destinationChain, bytes destinationAddress, uint256 amount, bytes metadata, uint256 gasValue) payable",
]);

// ASCII → 0x-prefixed hex. The XRPL destination is the recipient's classic
// r-address, delivered to ITS as the raw ASCII bytes of that string.
const asciiToHex = (s: string): string =>
  "0x" +
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Build the RelayAdapt multicall for an unshield-to-XRPL: call
 * ITS.interchainTransfer to bridge `amount` back to the XRPL account holder.
 * XRP is a mint/burn interchain token, so ITS burns it straight from the
 * RelayAdapt (the `msg.sender` here) — no approval call is needed.
 */
export function buildUnshieldCrossContractCalls({
  amount,
  xrplRecipient,
  gasValue = RETURN_GAS_VALUE,
}: {
  /** amount in base units, matching the unshielded amount */
  amount: bigint;
  /** the destination XRPL classic address (r…) */
  xrplRecipient: string;
  /**
   * Native XRP to forward into the ITS call as call.value. Defaults to
   * RETURN_GAS_VALUE; pass 0n when building calls for gas estimation, where the
   * RelayAdapt has no native balance and a payable sub-call would revert.
   */
  gasValue?: bigint;
}): ContractTransaction[] {
  if (!XRP_TOKEN_ID) {
    throw new Error("its: XRP_TOKEN_ID is not configured (see lib/its.ts)");
  }
  if (!xrplRecipient.startsWith("r")) {
    throw new Error("its: XRPL recipient must be a classic r-address");
  }

  const destinationAddress = asciiToHex(xrplRecipient);

  return [
    {
      to: ITS_ADDRESS,
      data: itsInterface.encodeFunctionData("interchainTransfer", [
        XRP_TOKEN_ID,
        DESTINATION_CHAIN,
        destinationAddress,
        amount,
        "0x", // metadata: empty = plain transfer
        gasValue, // native paid to the Axelar gas service (≤ msg.value)
      ]),
      value: gasValue,
    },
  ];
}
