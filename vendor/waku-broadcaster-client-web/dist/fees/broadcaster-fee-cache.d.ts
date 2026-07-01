import { CachedTokenFee, Chain } from '@railgun-community/shared-models';
type BroadcasterFeeNetworkTokenBroadcasterCacheMap = {
    forIdentifier: MapType<CachedTokenFee>;
};
type BroadcasterFeeNetworkTokenCacheMap = {
    forBroadcaster: MapType<BroadcasterFeeNetworkTokenBroadcasterCacheMap>;
};
type BroadcasterFeeNetworkCacheMap = {
    forToken: MapType<BroadcasterFeeNetworkTokenCacheMap>;
};
export type BroadcasterFeeCacheState = {
    forNetwork: MapType<BroadcasterFeeNetworkCacheMap>;
};
export declare class BroadcasterFeeCache {
    private static cache;
    private static authorizedFees;
    private static averageAuthorizedFees;
    static lastSubscribedFeeMessageReceivedAt: Optional<number>;
    private static poiActiveListKeys;
    static init(poiActiveListKeys: string[]): void;
    static addTokenFees(chain: Chain, railgunAddress: string, feeExpiration: number, tokenFeeMap: MapType<CachedTokenFee>, identifier: Optional<string>, version: string, requiredPOIListKeys: string[]): void;
    static resetCache(chain: Chain): void;
    static feesForChain(chain: Chain): Optional<BroadcasterFeeNetworkCacheMap>;
    static feesForToken(chain: Chain, tokenAddress: string): Optional<BroadcasterFeeNetworkTokenCacheMap>;
    static supportsToken(chain: Chain, tokenAddress: string, useRelayAdapt: boolean): boolean;
    static addAuthorizedFees(signerAddress: string, tokenFeeMap: MapType<CachedTokenFee>): void;
    private static updateAverageAuthorizedFees;
    static getAuthorizedFee(tokenAddress: string): Optional<CachedTokenFee>;
}
export {};
