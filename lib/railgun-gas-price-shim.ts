// Build-time replacement for @railgun-community/wallet's internal
// `dist/utils/gas-price.js` (wired up via NormalModuleReplacementPlugin in
// next.config.js). The original is a hardcoded switch of known networks that
// `throw new Error('Undefined networkName')` for anything else — including our
// custom XRPL_EVM network — on broadcaster transactions (sendWithPublicWallet
// = false). There's no registration hook, so we reimplement it verbatim and add
// XRPL_EVM.
//
// Keep the non-XRPL branches identical to upstream so every other network keeps
// its exact behavior; only the XRPL_EVM case is new.
import { NetworkName } from "@railgun-community/shared-models";

export const shouldSetOverallBatchMinGasPriceForNetwork = (
  sendWithPublicWallet: boolean,
  networkName: NetworkName,
): boolean => {
  if (sendWithPublicWallet) {
    // Only Broadcaster transactions require overallBatchMinGasPrice.
    return false;
  }

  // XRPL EVM is an EIP-1559 L2-style sidechain — treat it like Arbitrum: don't
  // bind overallBatchMinGasPrice (the contract's minGasPrice check is type-0
  // only, and XRPL EVM is type-2).
  if ((networkName as string) === "XRPL_EVM") {
    return false;
  }

  switch (networkName) {
    case NetworkName.Arbitrum:
      // L2s should not set overallBatchMinGasPrice.
      return false;
    case NetworkName.Ethereum:
    case NetworkName.BNBChain:
    case NetworkName.Polygon:
    case NetworkName.PolygonAmoy:
    case NetworkName.ArbitrumGoerli_DEPRECATED:
    case NetworkName.EthereumRopsten_DEPRECATED:
    case NetworkName.EthereumGoerli_DEPRECATED:
    case NetworkName.PolygonMumbai_DEPRECATED:
    case NetworkName.EthereumSepolia:
    case NetworkName.Hardhat:
      return true;
    default:
      throw new Error("Undefined networkName");
  }
};
