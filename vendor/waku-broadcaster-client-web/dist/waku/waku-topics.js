import { BroadcasterConfig } from '../models/broadcaster-config.js';
export const contentTopics = {
    default: () => `/${BroadcasterConfig.contentTopicApp}/v2/default/json`,
    fees: (chain) => `/${BroadcasterConfig.contentTopicApp}/v2/${chain.type}-${chain.id}-fees/json`,
    transact: (chain) => `/${BroadcasterConfig.contentTopicApp}/v2/${chain.type}-${chain.id}-transact/json`,
    transactResponse: (chain) => `/${BroadcasterConfig.contentTopicApp}/v2/${chain.type}-${chain.id}-transact-response/json`,
    metrics: () => `/${BroadcasterConfig.contentTopicApp}/v2/metrics/json`,
    encrypted: (topic) => `/${BroadcasterConfig.contentTopicApp}/v2/encrypted-${topic}/json`,
};
//# sourceMappingURL=waku-topics.js.map