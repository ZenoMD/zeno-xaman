import { createLightNode } from '@waku/sdk';
import { BroadcasterDebug } from '../utils/broadcaster-debug.js';
import { enrTree, wakuDnsDiscovery, wakuPeerExchangeDiscovery } from '@waku/discovery';
import { isDefined } from '@railgun-community/shared-models';
import { WAKU_RAILGUN_DEFAULT_PEERS_WEB } from '../models/constants.js';
import { WakuBroadcasterPeerDiscoveryCoreBase } from './waku-broadcaster-peer-discovery-core-base.js';
export class WakuBroadcasterWakuCore extends WakuBroadcasterPeerDiscoveryCoreBase {
    static createWakuNode = createLightNode;
    static createDnsPeerDiscovery = wakuDnsDiscovery;
    static createPeerExchangeDiscovery = wakuPeerExchangeDiscovery;
    static getEnrTrees() {
        return enrTree;
    }
    static getDefaultPeers() {
        return WAKU_RAILGUN_DEFAULT_PEERS_WEB;
    }
    static synthesizeWssMultiaddr(multiaddr) {
        if (/\/wss(?:\/|$)/.test(multiaddr) || /\/ws(?:\/|$)/.test(multiaddr)) {
            return multiaddr;
        }
        const webPortMatch = multiaddr.match(/^(\/dns(?:4|6)\/[^/]+\/tcp\/(?:8000|443))(\/p2p\/[^/]+)$/);
        if (webPortMatch) {
            const [, base, peerSuffix] = webPortMatch;
            return `${base}/wss${peerSuffix}`;
        }
        return undefined;
    }
    static getPeerInfoWssMultiaddrs(peerInfo) {
        return [
            ...new Set(this.getPeerInfoMultiaddrStrings(peerInfo)
                .map(multiaddr => this.synthesizeWssMultiaddr(multiaddr))
                .filter(isDefined)),
        ];
    }
    static async enforceConnectionCap() {
        const libp2p = this.waku?.libp2p;
        if (!libp2p) {
            return;
        }
        const connections = libp2p.getConnections?.() ?? [];
        if (connections.length <= this.maxConnections) {
            return;
        }
        const bootstrapPeerIds = this.getConfiguredBootstrapPeerIds();
        const removableConnections = [...connections].sort((a, b) => {
            const aIsBootstrap = bootstrapPeerIds.has(this.formatDiscoveryPeerId(a?.remotePeer));
            const bIsBootstrap = bootstrapPeerIds.has(this.formatDiscoveryPeerId(b?.remotePeer));
            return Number(bIsBootstrap) - Number(aIsBootstrap);
        });
        const excessConnections = removableConnections.slice(this.maxConnections);
        for (const connection of excessConnections) {
            await libp2p.hangUp(connection.remotePeer).catch(() => { });
        }
    }
    static getDialableMultiaddrs(peerInfo) {
        return this.getPeerInfoWssMultiaddrs(peerInfo);
    }
    static mapNewPeerInfo(peerInfo) {
        const dialableMultiaddrs = this.getDialableMultiaddrs(peerInfo);
        if (!dialableMultiaddrs.length) {
            return undefined;
        }
        return {
            ...peerInfo,
            multiaddrs: dialableMultiaddrs,
        };
    }
    static onBeforeSelectPeerInfos() {
        this.pruneAdmittedPeerExchangePeerIds();
    }
    static async onPeerInfosSelected(peerInfos) {
        await this.dialDiscoveredPeers(peerInfos);
    }
    static getPeerExchangeAttemptBuffer() {
        return 2;
    }
    static applyConnectionLimitGuard() {
        const connectionManager = this.waku?.connectionManager;
        const dialer = connectionManager?.dialer;
        const libp2p = this.waku?.libp2p;
        if (!dialer || !libp2p || dialer.__wakuConnectionLimitGuardApplied) {
            return;
        }
        const originalShouldSkipPeer = dialer.shouldSkipPeer?.bind(dialer);
        if (typeof originalShouldSkipPeer !== 'function') {
            return;
        }
        dialer.shouldSkipPeer = async (peerId) => {
            const shouldSkip = await originalShouldSkipPeer(peerId);
            if (shouldSkip) {
                return true;
            }
            const connectionCount = libp2p.getConnections().length;
            if (connectionCount >= this.maxConnections) {
                return true;
            }
            return false;
        };
        dialer.__wakuConnectionLimitGuardApplied = true;
        if (!libp2p.__wakuConnectionCapListenerApplied) {
            libp2p.addEventListener?.('peer:connect', (_event) => {
                void this.enforceConnectionCap();
            });
            libp2p.__wakuConnectionCapListenerApplied = true;
        }
    }
    static buildDnsPeerDiscovery(enrTreePeers) {
        return this.createDialingDnsPeerDiscovery(enrTreePeers);
    }
    static async afterNodeCreated() {
        await this.flushPendingDiscoveredPeers();
    }
    static async beforeNodeStart() {
        BroadcasterDebug.log('Start Waku.');
    }
    static async afterNodeStart() {
        await this.flushPendingDiscoveredPeers();
    }
    static getConnectedLogMessage() {
        return 'Connected to Waku';
    }
    static handleConnectError(err) {
        if (!(err instanceof Error)) {
            throw err;
        }
        this.hasError = true;
        throw err;
    }
}
//# sourceMappingURL=waku-broadcaster-waku-core.js.map