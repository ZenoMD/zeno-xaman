export type WakuShardInfo = {
    clusterId: number;
    shard: number;
    shardId: number;
    pubsubTopic: string;
};
export type WakuNetworkConfig = {
    clusterId: number;
    shards: number[];
};
export declare const formatWakuRelayShardTopic: (clusterId: number, shardId: number) => string;
export declare const createWakuShardInfo: (clusterId: number, shardId: number, pubsubTopic?: string) => WakuShardInfo;
export declare const createWakuNetworkConfig: (clusterId: number, shardId: number) => WakuNetworkConfig;
export declare const parseWakuRelayShardTopic: (pubSubTopic: string) => {
    clusterId: number;
    shardId: number;
} | undefined;
export declare const WAKU_RAILGUN_PUB_SUB_TOPIC: string;
export declare const WAKU_RAILGUN_DEFAULT_SHARD: WakuShardInfo;
export declare const WAKU_RAILGUN_DEFAULT_NETWORK_CONFIG: WakuNetworkConfig;
export declare const WAKU_RAILGUN_DEFAULT_SHARDS: {
    clusterId: number;
    shards: number[];
};
export declare const WAKU_RAILGUN_DEFAULT_ENR_TREE_URL = "enrtree://APMYHUVNQWHJNPI5L2KQ765EMCKUAMRWPUH3U2QIKPK6XEV3OW442@discovery.rootedinprivacy.com";
export declare const WAKU_RAILGUN_DEFAULT_PEERS_WEB: string[];
export declare const WAKU_RAILGUN_DEFAULT_PEERS_NODE: string[];
