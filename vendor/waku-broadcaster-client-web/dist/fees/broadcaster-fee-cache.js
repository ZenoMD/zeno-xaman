import { networkForChain, } from '@railgun-community/shared-models';
import { AddressFilter } from '../filters/address-filter.js';
import { BroadcasterConfig } from '../models/broadcaster-config.js';
import { BroadcasterDebug } from '../utils/broadcaster-debug.js';
import { nameForBroadcaster, cachedFeeExpired, DEFAULT_BROADCASTER_IDENTIFIER, invalidBroadcasterVersion, cachedFeeUnavailableOrExpired, } from '../utils/broadcaster-util.js';
export class BroadcasterFeeCache {
    static cache = { forNetwork: {} };
    static authorizedFees = {};
    static averageAuthorizedFees = {};
    static lastSubscribedFeeMessageReceivedAt;
    static poiActiveListKeys;
    static init(poiActiveListKeys) {
        this.poiActiveListKeys = poiActiveListKeys;
        this.lastSubscribedFeeMessageReceivedAt = Date.now();
    }
    static addTokenFees(chain, railgunAddress, feeExpiration, tokenFeeMap, identifier, version, requiredPOIListKeys) {
        const network = networkForChain(chain);
        if (!network) {
            return;
        }
        if (!this.poiActiveListKeys) {
            throw new Error('Must define active POI list keys before adding any fees.');
        }
        for (const listKey of requiredPOIListKeys) {
            if (!this.poiActiveListKeys.includes(listKey)) {
                BroadcasterDebug.log(`[Fees] Broadcaster ${railgunAddress} requires POI list key ${listKey}, which is not active.`);
                return;
            }
        }
        const broadcasterName = nameForBroadcaster(railgunAddress, identifier);
        const networkName = network.name;
        if (invalidBroadcasterVersion(version)) {
            BroadcasterDebug.log(`[Fees] Broadcaster version ${version} invalid (req ${BroadcasterConfig.MINIMUM_BROADCASTER_VERSION}-${BroadcasterConfig.MAXIMUM_BROADCASTER_VERSION}): ${broadcasterName}`);
            return;
        }
        if (cachedFeeExpired(feeExpiration)) {
            BroadcasterDebug.log(`[Fees] Fees expired for ${networkName} (${broadcasterName})`);
            return;
        }
        const tokenAddresses = Object.keys(tokenFeeMap);
        BroadcasterDebug.log(`[Fees] Updating fees for ${networkName} (${broadcasterName}): ${tokenAddresses.length} tokens`);
        this.cache.forNetwork[networkName] ??= { forToken: {} };
        const tokenAddressesLowercase = tokenAddresses.map(address => address.toLowerCase());
        tokenAddressesLowercase.forEach(tokenAddress => {
            this.cache.forNetwork[networkName].forToken[tokenAddress] ??= {
                forBroadcaster: {},
            };
            this.cache.forNetwork[networkName].forToken[tokenAddress].forBroadcaster[railgunAddress] ??= { forIdentifier: {} };
            this.cache.forNetwork[networkName].forToken[tokenAddress].forBroadcaster[railgunAddress].forIdentifier[identifier ?? DEFAULT_BROADCASTER_IDENTIFIER] =
                tokenFeeMap[tokenAddress];
        });
        BroadcasterFeeCache.lastSubscribedFeeMessageReceivedAt = Date.now();
    }
    static resetCache(chain) {
        const network = networkForChain(chain);
        if (!network) {
            return;
        }
        this.cache.forNetwork ??= {};
        delete this.cache.forNetwork[network.name];
    }
    static feesForChain(chain) {
        const network = networkForChain(chain);
        if (!network) {
            throw new Error('Chain not found.');
        }
        return this.cache.forNetwork[network.name];
    }
    static feesForToken(chain, tokenAddress) {
        return this.feesForChain(chain)?.forToken[tokenAddress.toLowerCase()];
    }
    static supportsToken(chain, tokenAddress, useRelayAdapt) {
        const feesForToken = this.feesForToken(chain, tokenAddress);
        if (!feesForToken) {
            return false;
        }
        const railgunAddresses = Object.keys(feesForToken.forBroadcaster);
        const filteredRailgunAddresses = AddressFilter.filter(railgunAddresses);
        const cachedFees = filteredRailgunAddresses
            .map(railgunAddress => Object.values(feesForToken.forBroadcaster[railgunAddress].forIdentifier))
            .flat();
        const availableUnexpiredFee = cachedFees.find(cachedFee => !cachedFeeUnavailableOrExpired(cachedFee, chain, useRelayAdapt));
        return availableUnexpiredFee != null;
    }
    static addAuthorizedFees(signerAddress, tokenFeeMap) {
        const newFees = Object.entries(tokenFeeMap);
        const signerAddressLC = signerAddress.toLowerCase();
        this.authorizedFees[signerAddressLC] ??= {};
        const updatedTokens = [];
        for (const [tokenAddress, feeMap] of newFees) {
            const tokenAddressLC = tokenAddress.toLowerCase();
            const existing = this.authorizedFees[signerAddressLC][tokenAddressLC];
            if (existing && existing.expiration >= feeMap.expiration) {
                continue;
            }
            this.authorizedFees[signerAddressLC][tokenAddressLC] = feeMap;
            updatedTokens.push(tokenAddressLC);
        }
        this.updateAverageAuthorizedFees(updatedTokens);
    }
    static updateAverageAuthorizedFees(tokenAddresses) {
        const trustedSigners = BroadcasterConfig.trustedFeeSigner;
        const isTrustedSignerConfigured = trustedSigners != null &&
            (typeof trustedSigners === 'string' || trustedSigners.length > 0);
        tokenAddresses.forEach(tokenAddressLC => {
            const authorizedFeesForToken = [];
            Object.keys(this.authorizedFees).forEach(signerAddress => {
                if (isTrustedSignerConfigured) {
                    if (typeof trustedSigners === 'string') {
                        if (signerAddress !== trustedSigners.toLowerCase()) {
                            return;
                        }
                    }
                    else if (Array.isArray(trustedSigners)) {
                        if (!trustedSigners
                            .map(s => s.toLowerCase())
                            .includes(signerAddress.toLowerCase())) {
                            return;
                        }
                    }
                }
                const fee = this.authorizedFees[signerAddress][tokenAddressLC];
                if (fee) {
                    if (cachedFeeExpired(fee.expiration)) {
                        delete this.authorizedFees[signerAddress][tokenAddressLC];
                        return;
                    }
                    authorizedFeesForToken.push(fee);
                }
            });
            if (authorizedFeesForToken.length === 0) {
                delete this.averageAuthorizedFees[tokenAddressLC];
                return;
            }
            if (authorizedFeesForToken.length === 1) {
                this.averageAuthorizedFees[tokenAddressLC] = authorizedFeesForToken[0];
                return;
            }
            let totalFee = 0n;
            authorizedFeesForToken.forEach(fee => {
                totalFee += BigInt(fee.feePerUnitGas);
            });
            const averageFee = totalFee / BigInt(authorizedFeesForToken.length);
            const baseFee = authorizedFeesForToken[0];
            this.averageAuthorizedFees[tokenAddressLC] = {
                ...baseFee,
                feePerUnitGas: '0x' + averageFee.toString(16),
            };
        });
    }
    static getAuthorizedFee(tokenAddress) {
        return this.averageAuthorizedFees[tokenAddress.toLowerCase()];
    }
}
//# sourceMappingURL=broadcaster-fee-cache.js.map