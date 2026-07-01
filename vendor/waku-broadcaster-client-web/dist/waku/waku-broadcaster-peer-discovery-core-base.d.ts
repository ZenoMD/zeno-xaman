import { type CreateLibp2pOptions } from '@waku/sdk';
import { WakuBroadcasterWakuCoreBase } from './waku-broadcaster-waku-core-base.js';
export declare abstract class WakuBroadcasterPeerDiscoveryCoreBase extends WakuBroadcasterWakuCoreBase {
    protected static readonly maxBootstrapPeers = 2;
    protected static readonly maxConnections = 5;
    protected static admittedPeerExchangePeerIds: Set<string>;
    protected static dialingPeerExchangePeerIds: Set<string>;
    protected static pendingDiscoveredPeerInfos: Map<string, any>;
    protected static createWakuNode: (options: any) => Promise<any>;
    protected static createDnsPeerDiscovery: (enrTreePeers: string[]) => any;
    protected static createPeerExchangeDiscovery: () => (components: any) => any;
    protected static getEnrTrees(): {
        SANDBOX: string;
        TEST: string;
    };
    protected static getDefaultPeers(): string[];
    protected static getBaseLibp2pOptions(): CreateLibp2pOptions;
    protected static buildDnsPeerDiscovery(enrTreePeers: string[]): any;
    protected static getDnsDiscoveryUrls(): string[];
    protected static getConnectionManagerOptions(): {
        connectionManager: {
            maxBootstrapPeers: number;
            maxConnections: number;
        };
    };
    protected static formatDiscoveryPeerId(peerId: any): string;
    protected static getKnownPeerIds(peerStore?: {
        all?: () => Promise<any[]>;
    }): Promise<Set<string>>;
    protected static getPeerInfoId(peerInfo: any): string;
    protected static getPeerInfoMultiaddrStrings(peerInfo: any): string[];
    protected static getConnectedPeerIds(): Set<string>;
    protected static getConfiguredBootstrapPeerIds(): Set<string>;
    protected static pruneAdmittedPeerExchangePeerIds(): void;
    protected static queueDiscoveredPeer(peerInfo: any): void;
    protected static flushPendingDiscoveredPeers(): Promise<void>;
    protected static getDialableMultiaddrs(_peerInfo: any): string[];
    protected static handleDialDiscoveredPeerFailure(peerId: string): void;
    protected static createDialingDnsPeerDiscovery(enrTreePeers: string[]): (components: any) => any;
    protected static dialDiscoveredPeers(peerInfos: any[]): Promise<void>;
    protected static mapNewPeerInfo(peerInfo: any): any | undefined;
    protected static onBeforeSelectPeerInfos(): void;
    protected static onPeerInfosSelected(_peerInfos: any[]): Promise<void>;
    protected static getPeerExchangeAttemptBuffer(): number;
    protected static resetPlatformDiscoveryState(): void;
    protected static afterNodeCreated(): Promise<void>;
    protected static beforeNodeStart(): Promise<void>;
    protected static afterNodeStart(): Promise<void>;
    protected static applyConnectionLimitGuard(): void;
    protected static getConnectedLogMessage(): string;
    protected static handleConnectError(err: unknown): void;
    protected static createLoggedPeerExchangeDiscovery(): (components: any) => any;
    protected static connect(): Promise<void>;
}
