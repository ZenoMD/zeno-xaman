import { networkForChain, versionCompare, } from '@railgun-community/shared-models';
import { BroadcasterConfig } from '../models/broadcaster-config.js';
import { isDefined } from './is-defined.js';
const FEE_EXPIRATION_MINIMUM_MSEC = 40000;
export const DEFAULT_BROADCASTER_IDENTIFIER = 'default';
export const shortenAddress = (address) => {
    if (address.length < 13) {
        return address;
    }
    return `${address.slice(0, 8)}...${address.slice(-4)}`;
};
export const nameForBroadcaster = (railgunAddress, identifier) => {
    const shortAddress = shortenAddress(railgunAddress);
    if (isDefined(identifier)) {
        return `${shortAddress}: ${identifier}`;
    }
    return shortAddress;
};
export const cachedFeeExpired = (feeExpiration) => {
    return feeExpiration < Date.now() + FEE_EXPIRATION_MINIMUM_MSEC;
};
export const invalidBroadcasterVersion = (version) => {
    return (versionCompare(version ?? '0.0.0', BroadcasterConfig.MINIMUM_BROADCASTER_VERSION) < 0 ||
        versionCompare(version ?? '0.0.0', BroadcasterConfig.MAXIMUM_BROADCASTER_VERSION) > 0);
};
export const cachedFeeUnavailableOrExpired = (cachedFee, chain, useRelayAdapt) => {
    if (useRelayAdapt) {
        const relayAdapt = cachedFee.relayAdapt;
        if (!relayAdapt) {
            return true;
        }
        const network = networkForChain(chain);
        if (!network) {
            throw new Error(`Unrecognized chain ${chain}`);
        }
        const expectedRelayAdapt = network.relayAdaptHistory;
        if (relayAdapt && !expectedRelayAdapt.includes(relayAdapt)) {
            return true;
        }
    }
    if (cachedFee.availableWallets === 0) {
        return true;
    }
    if (cachedFeeExpired(cachedFee.expiration)) {
        return true;
    }
    return false;
};
//# sourceMappingURL=broadcaster-util.js.map