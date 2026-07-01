import { Chain } from '@railgun-community/shared-models';
import { type LightNode } from '@waku/sdk';
import { BroadcasterOptions } from '../models/index.js';
export declare abstract class WakuBroadcasterWakuCoreBase {
    static hasError: boolean;
    static restartCallback: () => void;
    static waku: Optional<LightNode>;
    protected static pubSubTopic: string;
    protected static additionalDirectPeers: string[];
    protected static peerDiscoveryTimeout: number;
    static restartCount: number;
    static initWaku(chain: Chain): Promise<void>;
    static pollHistoricalTopics(): Promise<void>;
    static setWakuRestartCallback(callback: () => void): void;
    static reinitWaku(chain: Chain): Promise<void>;
    static setBroadcasterOptions(broadcasterOptions: BroadcasterOptions): void;
    static disconnect(): Promise<void>;
    protected static connect(): Promise<void>;
    static getMeshPeerCount(): number;
    static getPubSubPeerCount(): number;
    static getLightPushPeerCount(): Promise<number>;
    static getFilterPeerCount(): Promise<number>;
    static getHealthSnapshot(): Promise<{
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
    private static getLightPushAcceptedCount;
    static broadcastMessage(data: object, topic: string): Promise<void>;
    static retrieveHistoricalForTopic(topic: string): Promise<void>;
}
