import { Chain, SelectedBroadcaster } from '@railgun-community/shared-models';
export declare class BroadcasterSearch {
    static findBroadcastersForToken(chain: Chain, tokenAddress: string, useRelayAdapt: boolean, ignoreMissingAuthorizedFee?: boolean): Optional<SelectedBroadcaster[]>;
    static findAllBroadcastersForChain(chain: Chain, useRelayAdapt: boolean, ignoreMissingAuthorizedFee?: boolean): Optional<SelectedBroadcaster[]>;
    static findRandomBroadcasterForToken(chain: Chain, tokenAddress: string, useRelayAdapt: boolean, percentageThreshold: number): Optional<SelectedBroadcaster>;
    static findBestBroadcaster(chain: Chain, tokenAddress: string, useRelayAdapt: boolean): Optional<SelectedBroadcaster>;
}
