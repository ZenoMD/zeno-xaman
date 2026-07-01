import type { CustomDNSConfig } from '../models/broadcaster-config.js';
type PeerStore = {
    all?: () => Promise<any[]>;
};
type ConnectionManagerOptions = {
    connectionManager: {
        maxBootstrapPeers: number;
        maxConnections: number;
    };
};
type PeerExchangeDiscoveryConfig = {
    createPeerExchangeDiscovery: () => (components: any) => any;
    getAdmittedPeerExchangePeerIds: () => Set<string>;
    getKnownPeerIds?: (peerStore?: PeerStore) => Promise<Set<string>>;
    getPeerInfoId: (peerInfo: any) => string;
    mapNewPeerInfo?: (peerInfo: any) => any | undefined;
    maxBootstrapPeers: number;
    maxConnections: number;
    onBeforeSelectPeerInfos?: () => void;
    onPeerInfosSelected?: (peerInfos: any[]) => Promise<void> | void;
    peerExchangeAttemptBuffer?: number;
};
export declare const formatDiscoveryPeerId: (peerId: any) => string;
export declare const getKnownPeerIds: (peerStore?: PeerStore) => Promise<Set<string>>;
export declare const getDnsDiscoveryUrls: (enrTrees: {
    SANDBOX: string;
    TEST: string;
}, customDNS?: CustomDNSConfig) => string[];
export declare const getConnectionManagerOptions: (maxBootstrapPeers: number, maxConnections: number) => ConnectionManagerOptions;
export declare const createLoggedPeerExchangeDiscovery: ({ createPeerExchangeDiscovery, getAdmittedPeerExchangePeerIds, getKnownPeerIds: getKnownPeerIdsImpl, getPeerInfoId, mapNewPeerInfo, maxBootstrapPeers, maxConnections, onBeforeSelectPeerInfos, onPeerInfosSelected, peerExchangeAttemptBuffer, }: PeerExchangeDiscoveryConfig) => (components: any) => any;
export {};
