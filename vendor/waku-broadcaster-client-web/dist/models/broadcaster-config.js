import { createWakuNetworkConfig, createWakuShardInfo, formatWakuRelayShardTopic, parseWakuRelayShardTopic, WAKU_RAILGUN_DEFAULT_ENR_TREE_URL, WAKU_RAILGUN_DEFAULT_SHARD, } from './constants.js';
export class BroadcasterConfig {
    static IS_DEV = false;
    static enableHealthcheckLogs = false;
    static contentTopicApp = 'railgun';
    static trustedFeeSigner;
    static feeExpirationTimeout = 120_000;
    static historicalLookBackTime = 1 * 60 * 1000;
    static authorizedFeeVariancePercentageLower = 0.10;
    static authorizedFeeVariancePercentageUpper = 0.30;
    static MINIMUM_BROADCASTER_VERSION = '8.0.0';
    static MAXIMUM_BROADCASTER_VERSION = '8.999.0';
    static useDNSDiscovery = true;
    static customDNS = undefined;
    static additionalDirectPeers = [];
    static storePeers = [];
    static clusterId = WAKU_RAILGUN_DEFAULT_SHARD.clusterId;
    static shardId = WAKU_RAILGUN_DEFAULT_SHARD.shardId;
    static pubSubTopic = WAKU_RAILGUN_DEFAULT_SHARD.pubsubTopic;
    static configureWakuNetwork(options) {
        const hasClusterId = options.clusterId !== undefined;
        const hasShardId = options.shardId !== undefined;
        let clusterId = options.clusterId ?? this.clusterId;
        let shardId = options.shardId ?? this.shardId;
        if (!hasClusterId && !hasShardId && options.pubSubTopic) {
            const parsed = parseWakuRelayShardTopic(options.pubSubTopic);
            if (parsed) {
                clusterId = parsed.clusterId;
                shardId = parsed.shardId;
            }
        }
        this.clusterId = clusterId;
        this.shardId = shardId;
        this.pubSubTopic =
            hasClusterId || hasShardId || !options.pubSubTopic
                ? formatWakuRelayShardTopic(clusterId, shardId)
                : options.pubSubTopic;
    }
    static getWakuRoutingInfo() {
        return createWakuShardInfo(this.clusterId, this.shardId, this.pubSubTopic);
    }
    static getWakuNetworkConfig() {
        return createWakuNetworkConfig(this.clusterId, this.shardId);
    }
    static normalizeStringArray(values) {
        if (!values) {
            return [];
        }
        return [...new Set(values.map(value => value.trim()).filter(Boolean))];
    }
    static configurePeerConnections(options) {
        const dnsDiscoveryUrls = this.normalizeStringArray(options.dnsDiscoveryUrls);
        const additionalDirectPeers = this.normalizeStringArray(options.additionalDirectPeers);
        const additionalPeers = this.normalizeStringArray(options.additionalPeers);
        const storePeers = this.normalizeStringArray(options.storePeers);
        this.additionalDirectPeers = [
            ...new Set([
                ...additionalDirectPeers,
                ...additionalPeers,
                ...storePeers,
            ]),
        ];
        this.storePeers = storePeers;
        if (dnsDiscoveryUrls.length > 0) {
            this.useDNSDiscovery = true;
            this.customDNS = {
                onlyCustom: true,
                enrTreePeers: dnsDiscoveryUrls,
            };
            return;
        }
        this.useDNSDiscovery = true;
        this.customDNS = options.useCustomDNS
            ? {
                onlyCustom: options.useCustomDNS.onlyCustom,
                enrTreePeers: this.normalizeStringArray(options.useCustomDNS.enrTreePeers),
            }
            : {
                onlyCustom: true,
                enrTreePeers: [WAKU_RAILGUN_DEFAULT_ENR_TREE_URL],
            };
    }
    static shouldUseDefaultBootstrap() {
        const hasCustomDnsPeers = Boolean(this.customDNS?.enrTreePeers.length);
        const hasDirectPeers = this.additionalDirectPeers.length > 0;
        return !hasCustomDnsPeers && !hasDirectPeers;
    }
    static setHealthcheckLoggingEnabled(enabled) {
        this.enableHealthcheckLogs = enabled;
    }
}
//# sourceMappingURL=broadcaster-config.js.map