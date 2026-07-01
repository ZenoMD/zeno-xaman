import { createLightNode } from '@waku/sdk';
import { wakuDnsDiscovery, wakuPeerExchangeDiscovery } from '@waku/discovery';
import { WakuBroadcasterPeerDiscoveryCoreBase } from './waku-broadcaster-peer-discovery-core-base.js';
export declare class WakuBroadcasterWakuCore extends WakuBroadcasterPeerDiscoveryCoreBase {
    protected static createWakuNode: typeof createLightNode;
    protected static createDnsPeerDiscovery: typeof wakuDnsDiscovery;
    protected static createPeerExchangeDiscovery: typeof wakuPeerExchangeDiscovery;
    protected static getEnrTrees(): {
        SANDBOX: string;
        TEST: string;
    };
    protected static getDefaultPeers(): string[];
    private static synthesizeWssMultiaddr;
    private static getPeerInfoWssMultiaddrs;
    private static enforceConnectionCap;
    protected static getDialableMultiaddrs(peerInfo: any): string[];
    protected static mapNewPeerInfo(peerInfo: any): any | undefined;
    protected static onBeforeSelectPeerInfos(): void;
    protected static onPeerInfosSelected(peerInfos: any[]): Promise<void>;
    protected static getPeerExchangeAttemptBuffer(): number;
    protected static applyConnectionLimitGuard(): void;
    protected static buildDnsPeerDiscovery(enrTreePeers: string[]): (components: any) => any;
    protected static afterNodeCreated(): Promise<void>;
    protected static beforeNodeStart(): Promise<void>;
    protected static afterNodeStart(): Promise<void>;
    protected static getConnectedLogMessage(): string;
    protected static handleConnectError(err: unknown): void;
}
