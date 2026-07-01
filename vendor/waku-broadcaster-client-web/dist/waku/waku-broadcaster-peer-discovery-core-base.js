import { Protocols, } from '@waku/sdk';
import { BroadcasterDebug } from '../utils/broadcaster-debug.js';
import { isDefined } from '../utils/is-defined.js';
import { BroadcasterConfig } from '../models/broadcaster-config.js';
import { WakuBroadcasterWakuCoreBase } from './waku-broadcaster-waku-core-base.js';
import { createLoggedPeerExchangeDiscovery, formatDiscoveryPeerId, getConnectionManagerOptions, getDnsDiscoveryUrls, getKnownPeerIds, } from './waku-peer-discovery.js';
export class WakuBroadcasterPeerDiscoveryCoreBase extends WakuBroadcasterWakuCoreBase {
    static maxBootstrapPeers = 2;
    static maxConnections = 5;
    static admittedPeerExchangePeerIds = new Set();
    static dialingPeerExchangePeerIds = new Set();
    static pendingDiscoveredPeerInfos = new Map();
    static createWakuNode;
    static createDnsPeerDiscovery;
    static createPeerExchangeDiscovery;
    static getEnrTrees() {
        throw new Error("Method 'getEnrTrees' must be implemented.");
    }
    static getDefaultPeers() {
        throw new Error("Method 'getDefaultPeers' must be implemented.");
    }
    static getBaseLibp2pOptions() {
        return {
            hideWebSocketInfo: true,
        };
    }
    static buildDnsPeerDiscovery(enrTreePeers) {
        return this.createDnsPeerDiscovery(enrTreePeers);
    }
    static getDnsDiscoveryUrls() {
        return getDnsDiscoveryUrls(this.getEnrTrees(), BroadcasterConfig.customDNS);
    }
    static getConnectionManagerOptions() {
        return getConnectionManagerOptions(this.maxBootstrapPeers, this.maxConnections);
    }
    static formatDiscoveryPeerId(peerId) {
        return formatDiscoveryPeerId(peerId);
    }
    static async getKnownPeerIds(peerStore) {
        return getKnownPeerIds(peerStore);
    }
    static getPeerInfoId(peerInfo) {
        return this.formatDiscoveryPeerId(peerInfo?.id ?? peerInfo?.ENR?.peerInfo?.id);
    }
    static getPeerInfoMultiaddrStrings(peerInfo) {
        const rawMultiaddrs = peerInfo?.multiaddrs ??
            peerInfo?.ENR?.peerInfo?.multiaddrs ??
            peerInfo?.ENR?.multiaddrs ??
            [];
        if (!Array.isArray(rawMultiaddrs)) {
            return [];
        }
        return rawMultiaddrs
            .map(multiaddr => multiaddr?.toString?.() ?? String(multiaddr ?? ''))
            .map(multiaddr => multiaddr.trim())
            .filter(Boolean);
    }
    static getConnectedPeerIds() {
        const connections = this.waku?.libp2p?.getConnections?.() ?? [];
        return new Set(connections.map((connection) => this.formatDiscoveryPeerId(connection?.remotePeer)));
    }
    static getConfiguredBootstrapPeerIds() {
        const directPeers = BroadcasterConfig.additionalDirectPeers.length
            ? BroadcasterConfig.additionalDirectPeers
            : this.getDefaultPeers();
        return new Set(directPeers
            .map(peer => peer.match(/\/p2p\/([^/]+)$/)?.[1])
            .filter(isDefined));
    }
    static pruneAdmittedPeerExchangePeerIds() {
        const connectedPeerIds = this.getConnectedPeerIds();
        this.admittedPeerExchangePeerIds = new Set([...this.admittedPeerExchangePeerIds].filter(peerId => connectedPeerIds.has(peerId)));
    }
    static queueDiscoveredPeer(peerInfo) {
        const peerId = this.getPeerInfoId(peerInfo);
        this.pendingDiscoveredPeerInfos.set(peerId, peerInfo);
    }
    static async flushPendingDiscoveredPeers() {
        if (!this.waku || this.pendingDiscoveredPeerInfos.size === 0) {
            return;
        }
        const peerInfos = [...this.pendingDiscoveredPeerInfos.values()];
        this.pendingDiscoveredPeerInfos.clear();
        await this.dialDiscoveredPeers(peerInfos);
    }
    static getDialableMultiaddrs(_peerInfo) {
        return [];
    }
    static handleDialDiscoveredPeerFailure(peerId) {
        this.admittedPeerExchangePeerIds.delete(peerId);
    }
    static createDialingDnsPeerDiscovery(enrTreePeers) {
        return (components) => {
            const discovery = this.createDnsPeerDiscovery(enrTreePeers)(components);
            const onPeer = ((event) => {
                this.queueDiscoveredPeer(event.detail);
                void this.dialDiscoveredPeers([event.detail]);
            });
            discovery.addEventListener?.('peer', onPeer);
            return discovery;
        };
    }
    static async dialDiscoveredPeers(peerInfos) {
        const waku = this.waku;
        if (!waku) {
            for (const peerInfo of peerInfos) {
                this.queueDiscoveredPeer(peerInfo);
            }
            return;
        }
        const connectedPeerIds = this.getConnectedPeerIds();
        await Promise.all(peerInfos.map(async (peerInfo) => {
            const peerId = this.getPeerInfoId(peerInfo);
            if (connectedPeerIds.has(peerId) ||
                this.dialingPeerExchangePeerIds.has(peerId)) {
                return;
            }
            const [multiaddr] = this.getDialableMultiaddrs(peerInfo);
            if (!multiaddr) {
                return;
            }
            this.dialingPeerExchangePeerIds.add(peerId);
            try {
                await waku.dial(multiaddr);
            }
            catch {
                this.handleDialDiscoveredPeerFailure(peerId);
            }
            finally {
                this.dialingPeerExchangePeerIds.delete(peerId);
            }
        }));
    }
    static mapNewPeerInfo(peerInfo) {
        return peerInfo;
    }
    static onBeforeSelectPeerInfos() { }
    static async onPeerInfosSelected(_peerInfos) { }
    static getPeerExchangeAttemptBuffer() {
        return 0;
    }
    static resetPlatformDiscoveryState() {
        this.admittedPeerExchangePeerIds.clear();
        this.dialingPeerExchangePeerIds.clear();
        this.pendingDiscoveredPeerInfos.clear();
    }
    static async afterNodeCreated() { }
    static async beforeNodeStart() { }
    static async afterNodeStart() { }
    static applyConnectionLimitGuard() { }
    static getConnectedLogMessage() {
        return 'Waku initialized and connected to peers';
    }
    static handleConnectError(err) {
        const message = err instanceof Error ? err.message : String(err);
        BroadcasterDebug.log(`Error initializing Waku: ${message}`);
        this.hasError = true;
    }
    static createLoggedPeerExchangeDiscovery() {
        return createLoggedPeerExchangeDiscovery({
            createPeerExchangeDiscovery: () => this.createPeerExchangeDiscovery(),
            getAdmittedPeerExchangePeerIds: () => this.admittedPeerExchangePeerIds,
            getKnownPeerIds: peerStore => this.getKnownPeerIds(peerStore),
            getPeerInfoId: peerInfo => this.getPeerInfoId(peerInfo),
            mapNewPeerInfo: peerInfo => this.mapNewPeerInfo(peerInfo),
            maxBootstrapPeers: this.maxBootstrapPeers,
            maxConnections: this.maxConnections,
            onBeforeSelectPeerInfos: () => this.onBeforeSelectPeerInfos(),
            onPeerInfosSelected: peerInfos => this.onPeerInfosSelected(peerInfos),
            peerExchangeAttemptBuffer: this.getPeerExchangeAttemptBuffer(),
        });
    }
    static async connect() {
        try {
            this.hasError = false;
            this.resetPlatformDiscoveryState();
            BroadcasterDebug.log('Creating waku broadcast client');
            const libp2pOptions = this.getBaseLibp2pOptions();
            if (BroadcasterConfig.useDNSDiscovery) {
                const enrTreePeers = this.getDnsDiscoveryUrls();
                libp2pOptions.peerDiscovery = [
                    this.buildDnsPeerDiscovery(enrTreePeers),
                    this.createLoggedPeerExchangeDiscovery(),
                ];
            }
            const defaultPeers = this.getDefaultPeers();
            const directPeers = BroadcasterConfig.additionalDirectPeers.length
                ? BroadcasterConfig.additionalDirectPeers
                : defaultPeers;
            const storePeers = BroadcasterConfig.storePeers.length
                ? BroadcasterConfig.storePeers
                : defaultPeers;
            this.waku = await this.createWakuNode({
                autoStart: false,
                defaultBootstrap: BroadcasterConfig.shouldUseDefaultBootstrap(),
                bootstrapPeers: directPeers,
                libp2p: libp2pOptions,
                networkConfig: BroadcasterConfig.getWakuNetworkConfig(),
                store: {
                    peers: storePeers,
                },
                ...this.getConnectionManagerOptions(),
            });
            const waku = this.waku;
            if (!waku) {
                throw new Error('Waku node was not created');
            }
            await this.afterNodeCreated();
            this.applyConnectionLimitGuard();
            await this.beforeNodeStart();
            await waku.start();
            await this.afterNodeStart();
            BroadcasterDebug.log('Waiting for remote peer.');
            await waku.waitForPeers([Protocols.Filter, Protocols.LightPush, Protocols.Store], this.peerDiscoveryTimeout);
            BroadcasterDebug.log(this.getConnectedLogMessage());
            this.hasError = false;
        }
        catch (err) {
            this.handleConnectError(err);
        }
    }
}
//# sourceMappingURL=waku-broadcaster-peer-discovery-core-base.js.map