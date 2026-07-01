import { delay, POI_REQUIRED_LISTS, BroadcasterConnectionStatus, isDefined, } from '@railgun-community/shared-models';
import { BroadcasterFeeCache } from './fees/broadcaster-fee-cache.js';
import { AddressFilter } from './filters/address-filter.js';
import { BroadcasterConfig } from './models/broadcaster-config.js';
import { BroadcasterSearch } from './search/best-broadcaster.js';
import { BroadcasterStatus } from './status/broadcaster-connection-status.js';
import { BroadcasterDebug } from './utils/broadcaster-debug.js';
import { WakuObservers } from './waku/waku-observers.js';
import { WakuBroadcasterWakuCore } from './waku/waku-broadcaster-waku-core.js';
import { contentTopics } from './waku/waku-topics.js';
export class WakuBroadcasterClient {
    static chain;
    static statusCallback;
    static started = false;
    static isRestarting = false;
    static pollDelay = 3_000;
    static async start(chain, broadcasterOptions, statusCallback, broadcasterDebugger) {
        this.chain = chain;
        this.statusCallback = statusCallback;
        WakuBroadcasterWakuCore.setBroadcasterOptions(broadcasterOptions);
        if (isDefined(broadcasterOptions.contentTopicApp)) {
            BroadcasterConfig.contentTopicApp = broadcasterOptions.contentTopicApp;
        }
        if (isDefined(broadcasterOptions.broadcasterVersionRange)) {
            BroadcasterConfig.MINIMUM_BROADCASTER_VERSION =
                broadcasterOptions.broadcasterVersionRange.minVersion;
            BroadcasterConfig.MAXIMUM_BROADCASTER_VERSION =
                broadcasterOptions.broadcasterVersionRange.maxVersion;
        }
        BroadcasterConfig.configurePeerConnections({
            useDNSDiscovery: broadcasterOptions.useDNSDiscovery,
            useCustomDNS: broadcasterOptions.useCustomDNS,
            dnsDiscoveryUrls: broadcasterOptions.dnsDiscoveryUrls,
            additionalDirectPeers: broadcasterOptions.additionalDirectPeers,
            additionalPeers: broadcasterOptions.additionalPeers,
            storePeers: broadcasterOptions.storePeers,
        });
        BroadcasterConfig.setHealthcheckLoggingEnabled(broadcasterOptions.enableHealthcheckLogs ?? false);
        if (isDefined(broadcasterDebugger)) {
            BroadcasterDebug.setDebugger(broadcasterDebugger);
        }
        BroadcasterFeeCache.init(broadcasterOptions.poiActiveListKeys ??
            POI_REQUIRED_LISTS.map(list => list.key));
        try {
            this.started = false;
            await WakuBroadcasterWakuCore.initWaku(chain);
            this.started = true;
            this.pollStatus();
        }
        catch (cause) {
            if (!(cause instanceof Error)) {
                throw new Error('Unexpected non-error thrown', { cause });
            }
            throw new Error('Cannot connect to Broadcaster network.', { cause });
        }
    }
    static async stop() {
        await WakuBroadcasterWakuCore.disconnect();
        this.started = false;
        this.updateStatus();
    }
    static isStarted() {
        return this.started;
    }
    static setHealthcheckLoggingEnabled(enabled) {
        BroadcasterConfig.setHealthcheckLoggingEnabled(enabled);
    }
    static async setChain(chain) {
        if (!WakuBroadcasterClient.started) {
            return;
        }
        WakuBroadcasterClient.chain = chain;
        await WakuObservers.setObserversForChain(WakuBroadcasterWakuCore.waku, chain);
        WakuBroadcasterClient.updateStatus();
    }
    static getContentTopics() {
        return WakuObservers.getCurrentContentTopics();
    }
    static getMeshPeerCount() {
        return WakuBroadcasterWakuCore.getMeshPeerCount();
    }
    static getPubSubPeerCount() {
        return WakuBroadcasterWakuCore.getPubSubPeerCount();
    }
    static async getLightPushPeerCount() {
        return await WakuBroadcasterWakuCore.getLightPushPeerCount();
    }
    static async getFilterPeerCount() {
        return await WakuBroadcasterWakuCore.getFilterPeerCount();
    }
    static findBestBroadcaster(chain, tokenAddress, useRelayAdapt) {
        if (!WakuBroadcasterClient.started) {
            return;
        }
        return BroadcasterSearch.findBestBroadcaster(chain, tokenAddress, useRelayAdapt);
    }
    static findAllBroadcastersForChain(chain, useRelayAdapt) {
        if (!WakuBroadcasterClient.started) {
            return [];
        }
        return BroadcasterSearch.findAllBroadcastersForChain(chain, useRelayAdapt);
    }
    static findRandomBroadcasterForToken(chain, tokenAddress, useRelayAdapt, percentageThreshold = 5) {
        if (!WakuBroadcasterClient.started) {
            return;
        }
        return BroadcasterSearch.findRandomBroadcasterForToken(chain, tokenAddress, useRelayAdapt, percentageThreshold);
    }
    static findBroadcastersForToken(chain, tokenAddress, useRelayAdapt) {
        if (!WakuBroadcasterClient.started) {
            return;
        }
        return BroadcasterSearch.findBroadcastersForToken(chain, tokenAddress, useRelayAdapt);
    }
    static setAddressFilters(allowlist, blocklist) {
        AddressFilter.setAllowlist(allowlist);
        AddressFilter.setBlocklist(blocklist);
    }
    static async tryReconnect() {
        BroadcasterFeeCache.resetCache(WakuBroadcasterClient.chain);
        WakuBroadcasterClient.updateStatus();
        await WakuBroadcasterClient.restart();
    }
    static supportsToken(chain, tokenAddress, useRelayAdapt) {
        return BroadcasterFeeCache.supportsToken(chain, tokenAddress, useRelayAdapt);
    }
    static async restart() {
        if (this.isRestarting || !this.started) {
            return;
        }
        this.isRestarting = true;
        try {
            BroadcasterDebug.log('Restarting Waku...');
            await WakuBroadcasterWakuCore.reinitWaku(this.chain);
            this.isRestarting = false;
        }
        catch (cause) {
            this.isRestarting = false;
            if (!(cause instanceof Error)) {
                return;
            }
            BroadcasterDebug.error(new Error('Error reinitializing Waku Broadcaster Client', { cause }));
        }
    }
    static async pollStatus() {
        const status = this.updateStatus();
        if (BroadcasterConfig.enableHealthcheckLogs) {
            await this.logHealthcheck(status);
        }
        await delay(WakuBroadcasterClient.pollDelay);
        this.pollStatus();
    }
    static updateStatus() {
        const status = BroadcasterStatus.getBroadcasterConnectionStatus(this.chain);
        this.statusCallback(this.chain, status);
        if (status === BroadcasterConnectionStatus.Disconnected ||
            status === BroadcasterConnectionStatus.Error) {
            this.restart();
        }
        return status;
    }
    static formatHealthcheckLog(healthSnapshot) {
        const discovery = healthSnapshot.discovery ?? {};
        const peerStore = discovery.peerStore ?? {};
        const connectedPeerDetails = discovery.connectedPeerDetails ?? [];
        const lines = [
            'Waku healthcheck:',
            `  status: ${healthSnapshot.status}`,
            `  chain: ${healthSnapshot.chain}`,
            `  started: ${healthSnapshot.started}, restarting: ${healthSnapshot.isRestarting}, wakuStarted: ${healthSnapshot.isStarted}, error: ${healthSnapshot.hasError}`,
            `  routing: cluster=${healthSnapshot.routing.clusterId}, shard=${healthSnapshot.routing.shardId}, topic=${healthSnapshot.routing.pubsubTopic}`,
            `  configured peers: dns=${healthSnapshot.configuredPeers.dnsDiscoveryUrls.length}, bootstrap=${healthSnapshot.configuredPeers.bootstrapPeers.length}, store=${healthSnapshot.configuredPeers.storePeers.length}`,
            `  connections: ${healthSnapshot.connections.count} / peers=${healthSnapshot.connections.peers.join(', ') || 'none'}`,
            `  peer store: total=${peerStore.count ?? 0}, bootstrap=${peerStore.bootstrapCount ?? 0}, peer-exchange=${peerStore.peerExchangeCount ?? 0}`,
            `  connected peer-exchange support: ${peerStore.connectedPeersSupportingPeerExchange?.join(', ') || 'none'}`,
            `  content topics: ${healthSnapshot.contentTopics.join(', ') || 'none'}`,
        ];
        if (connectedPeerDetails.length) {
            lines.push('  connected peer details:');
            for (const peer of connectedPeerDetails) {
                lines.push(`    - ${peer.peerId} | px=${peer.supportsPeerExchange} | tags=${peer.tags.join(', ') || 'none'} | protocols=${peer.protocols.join(', ') || 'none'}`);
            }
        }
        return lines.join('\n');
    }
    static async logHealthcheck(status) {
        const chain = this.chain
            ? `${this.chain.type}:${this.chain.id}`
            : 'undefined';
        const healthSnapshot = {
            pollDelay: this.pollDelay,
            started: this.started,
            isRestarting: this.isRestarting,
            chain,
            status,
            ...await WakuBroadcasterWakuCore.getHealthSnapshot(),
        };
        BroadcasterDebug.log(this.formatHealthcheckLog(healthSnapshot));
    }
    static async addTransportSubscription(waku, topic, callback) {
        await WakuObservers.addTransportSubscription(WakuBroadcasterWakuCore.waku, topic, callback);
    }
    static async sendTransport(data, topic) {
        const customTopic = contentTopics.encrypted(topic);
        try {
            await WakuBroadcasterWakuCore.broadcastMessage(data, customTopic);
        }
        catch (e) {
            BroadcasterDebug.log(`SendTransport error: ${e.message}`);
        }
    }
    static getWakuCore() {
        return WakuBroadcasterWakuCore.waku;
    }
    static setRestartCallback(callback) {
        WakuBroadcasterWakuCore.setWakuRestartCallback(callback);
    }
}
//# sourceMappingURL=waku-broadcaster-client.js.map