import { compareChains, delay } from '@railgun-community/shared-models';
import { createDecoder, } from '@waku/sdk';
import { contentTopics } from './waku-topics.js';
import { handleBroadcasterFeesMessage } from '../fees/handle-fees-message.js';
import { BroadcasterTransactResponse } from '../transact/broadcaster-transact-response.js';
import { BroadcasterDebug } from '../utils/broadcaster-debug.js';
import { isDefined } from '../utils/is-defined.js';
import { bytesToHex } from '../utils/conversion.js';
import { BroadcasterConfig } from '../models/broadcaster-config.js';
export class WakuObservers {
    static currentChain;
    static currentContentTopics = [];
    static currentSubscriptions = [];
    static messageCache = new Set();
    static observedMessages = [];
    static MAX_CACHE_SIZE = 5000;
    static resetMessageHistory() {
        this.messageCache = new Set();
        this.observedMessages = [];
    }
    static getMessageId(message) {
        const timestamp = message.timestamp ? message.timestamp.getTime() : 0;
        const payload = message.payload ? bytesToHex(message.payload) : '';
        return `${timestamp}-${payload}`;
    }
    static wrapCallbackWithCache(callback) {
        return (message) => {
            if (!message.payload) {
                return;
            }
            const messageId = this.getMessageId(message);
            if (this.messageCache.has(messageId)) {
                return;
            }
            this.messageCache.add(messageId);
            if (this.messageCache.size > this.MAX_CACHE_SIZE) {
                const first = this.messageCache.values().next().value;
                if (first) {
                    this.messageCache.delete(first);
                }
            }
            this.observedMessages.push(message);
            if (this.observedMessages.length > this.MAX_CACHE_SIZE) {
                this.observedMessages.shift();
            }
            callback(message);
        };
    }
    static setObserversForChain = async (waku, chain) => {
        if (!waku) {
            return;
        }
        if (WakuObservers.currentChain &&
            compareChains(WakuObservers.currentChain, chain)) {
            return;
        }
        BroadcasterDebug.log(`Add Waku observers for chain: ${chain.type}:${chain.id}`);
        WakuObservers.currentChain = chain;
        await this.removeAllObservers(waku);
        BroadcasterDebug.log('Removed all observers');
        await this.addChainObservers(waku, chain);
        BroadcasterDebug.log(`Waku listening for events on chain: ${chain.type}:${chain.id}`);
    };
    static resetCurrentChain = () => {
        this.currentChain = undefined;
        this.resetMessageHistory();
    };
    static checkSubscriptionsHealth = async (waku) => {
        BroadcasterDebug.log(`WAKU Health Status: ${waku?.health.getHealthStatus()}`);
        if (isDefined(this.currentSubscriptions)) {
            if (this.currentSubscriptions.length === 0) {
                BroadcasterDebug.log('No subscriptions to ping');
            }
        }
        await delay(15 * 1000);
        this.checkSubscriptionsHealth(waku);
    };
    static async unsubscribe(waku) {
        if (isDefined(waku) && isDefined(waku?.filter) && isDefined(this.currentSubscriptions)) {
            waku.filter.unsubscribeAll();
        }
        this.currentSubscriptions = [];
        this.currentContentTopics = [];
        this.resetMessageHistory();
    }
    static removeAllObservers = async (waku) => {
        await this.unsubscribe(waku);
    };
    static getDecodersForChain = (chain) => {
        const contentTopicFees = contentTopics.fees(chain);
        const contentTopicTransactResponse = contentTopics.transactResponse(chain);
        const feesDecoder = createDecoder(contentTopicFees, BroadcasterConfig.getWakuRoutingInfo());
        const transactResponseDecoder = createDecoder(contentTopicTransactResponse, BroadcasterConfig.getWakuRoutingInfo());
        const feesCallback = this.wrapCallbackWithCache((message) => handleBroadcasterFeesMessage(chain, message, contentTopicFees));
        const transactResponseCallback = this.wrapCallbackWithCache((message) => BroadcasterTransactResponse.handleBroadcasterTransactionResponseMessage(message));
        return [
            {
                topic: contentTopicFees,
                decoder: feesDecoder,
                callback: feesCallback,
            },
            {
                topic: contentTopicTransactResponse,
                decoder: transactResponseDecoder,
                callback: transactResponseCallback,
            },
        ];
    };
    static addChainObservers = async (waku, chain) => {
        if (!isDefined(waku.filter)) {
            return;
        }
        await this.addSubscriptions(chain, waku).catch(err => {
            BroadcasterDebug.log(`Error adding Observers. ${err.message}`);
            return undefined;
        });
        const currentContentTopics = WakuObservers.getCurrentContentTopics();
        BroadcasterDebug.log('Waku content topics:');
        for (const observer of currentContentTopics) {
            BroadcasterDebug.log(observer);
        }
    };
    static async addTransportSubscription(waku, topic, callback) {
        if (!isDefined(waku)) {
            BroadcasterDebug.log('No waku instance found, Transport Subscription not added.');
            return;
        }
        const transportTopic = contentTopics.encrypted(topic);
        const decoder = createDecoder(transportTopic, BroadcasterConfig.getWakuRoutingInfo());
        const wrappedCallback = this.wrapCallbackWithCache(callback);
        const params = {
            topic: transportTopic,
            decoder,
            callback: wrappedCallback,
        };
        await waku.filter.subscribe(decoder, wrappedCallback);
        this.currentSubscriptions?.push({
            params,
        });
        WakuObservers.currentContentTopics.push(transportTopic);
    }
    static async addSubscriptions(chain, waku) {
        if (!isDefined(chain) || !isDefined(waku)) {
            BroadcasterDebug.log('AddSubscription: No Waku or Chain defined.');
            return;
        }
        const subscriptionParams = this.getDecodersForChain(chain);
        const topics = subscriptionParams.map(params => params.topic);
        const newTopics = topics.filter(topic => !this.currentContentTopics.includes(topic));
        this.currentContentTopics.push(...newTopics);
        for (const params of subscriptionParams) {
            const { decoder, callback } = params;
            await waku.filter.subscribe(decoder, callback);
            this.currentSubscriptions?.push({
                params,
            });
        }
    }
    static getCurrentContentTopics() {
        return WakuObservers.currentContentTopics;
    }
    static getLastMessage(topic) {
        let latestMessage;
        for (const msg of this.observedMessages) {
            if (msg.contentTopic === topic) {
                if (!latestMessage) {
                    latestMessage = msg;
                    continue;
                }
                const msgTime = msg.timestamp ? msg.timestamp.getTime() : 0;
                const latestTime = latestMessage.timestamp ? latestMessage.timestamp.getTime() : 0;
                if (msgTime > latestTime) {
                    latestMessage = msg;
                }
            }
        }
        return latestMessage;
    }
    static getCallbackForTopic(topic) {
        const subscription = this.currentSubscriptions?.find(sub => sub.params.topic === topic);
        return subscription?.params.callback;
    }
}
//# sourceMappingURL=waku-observers.js.map