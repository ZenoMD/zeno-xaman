export type CustomDNSConfig = {
    onlyCustom: boolean;
    enrTreePeers: string[];
};
export declare class BroadcasterConfig {
    static IS_DEV: boolean;
    static enableHealthcheckLogs: boolean;
    static contentTopicApp: string;
    static trustedFeeSigner: string | string[];
    static feeExpirationTimeout: number;
    static historicalLookBackTime: number;
    static authorizedFeeVariancePercentageLower: number;
    static authorizedFeeVariancePercentageUpper: number;
    static MINIMUM_BROADCASTER_VERSION: string;
    static MAXIMUM_BROADCASTER_VERSION: string;
    static useDNSDiscovery: boolean;
    static customDNS: CustomDNSConfig | undefined;
    static additionalDirectPeers: string[];
    static storePeers: string[];
    static clusterId: number;
    static shardId: number;
    static pubSubTopic: string;
    static configureWakuNetwork(options: {
        clusterId?: number;
        shardId?: number;
        pubSubTopic?: string;
    }): void;
    static getWakuRoutingInfo(): import("./constants.js").WakuShardInfo;
    static getWakuNetworkConfig(): import("./constants.js").WakuNetworkConfig;
    private static normalizeStringArray;
    static configurePeerConnections(options: {
        useDNSDiscovery?: boolean;
        useCustomDNS?: CustomDNSConfig;
        dnsDiscoveryUrls?: string[];
        additionalDirectPeers?: string[];
        additionalPeers?: string[];
        storePeers?: string[];
    }): void;
    static shouldUseDefaultBootstrap(): boolean;
    static setHealthcheckLoggingEnabled(enabled: boolean): void;
}
