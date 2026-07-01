import { Chain, BroadcasterConnectionStatus } from '@railgun-community/shared-models';
export declare class BroadcasterStatus {
    static getBroadcasterConnectionStatus(chain: Chain): BroadcasterConnectionStatus;
    static hasSubscriptionsStalled(): boolean;
    private static hasBroadcasterFeesForNetwork;
    private static getAggregatedInfoForBroadcasters;
}
