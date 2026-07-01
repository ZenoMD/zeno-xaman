type HealthcheckConnection = {
    remotePeer?: {
        toString?: () => string;
    } | string;
};
type HealthcheckPeer = {
    id?: {
        toString?: () => string;
    } | string;
    protocols?: string[];
    tags?: Map<string, unknown>;
};
export declare const getWakuHealthSnapshot: (options: {
    hasError: boolean;
    peerDiscoveryTimeout: number;
    restartCount: number;
    waku?: {
        isStarted?: () => boolean;
        libp2p?: {
            getConnections?: () => HealthcheckConnection[];
            peerStore?: {
                all?: () => Promise<HealthcheckPeer[]>;
            };
        };
    };
}) => Promise<{
    hasWaku: boolean;
    isStarted: boolean;
    hasError: boolean;
    restartCount: number;
    peerDiscoveryTimeout: number;
    routing: import("../models/constants.js").WakuShardInfo;
    networkConfig: import("../models/constants.js").WakuNetworkConfig;
    configuredPeers: {
        useDNSDiscovery: boolean;
        dnsDiscoveryUrls: string[];
        bootstrapPeers: string[];
        storePeers: string[];
    };
    connections: {
        count: number;
        peers: string[];
    };
    discovery: {
        connectedPeerDetails: {
            peerId: string;
            supportsPeerExchange: boolean;
            protocols: string[];
            tags: string[];
        }[];
        peerStore: {
            count: number;
            bootstrapCount: number;
            peerExchangeCount: number;
            bootstrapPeers: string[];
            peerExchangePeers: string[];
            connectedPeersSupportingPeerExchange: string[];
        };
    };
    contentTopics: string[];
}>;
export {};
