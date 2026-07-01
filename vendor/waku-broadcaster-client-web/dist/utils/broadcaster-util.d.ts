import { CachedTokenFee, Chain } from '@railgun-community/shared-models';
export declare const DEFAULT_BROADCASTER_IDENTIFIER = "default";
export declare const shortenAddress: (address: string) => string;
export declare const nameForBroadcaster: (railgunAddress: string, identifier: Optional<string>) => string;
export declare const cachedFeeExpired: (feeExpiration: number) => boolean;
export declare const invalidBroadcasterVersion: (version: Optional<string>) => boolean;
export declare const cachedFeeUnavailableOrExpired: (cachedFee: CachedTokenFee, chain: Chain, useRelayAdapt: boolean) => boolean;
