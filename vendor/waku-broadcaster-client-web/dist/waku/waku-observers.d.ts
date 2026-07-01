import { Chain } from '@railgun-community/shared-models';
import { type LightNode, type IDecodedMessage } from '@waku/sdk';
export declare class WakuObservers {
    private static currentChain;
    private static currentContentTopics;
    private static currentSubscriptions;
    private static messageCache;
    private static observedMessages;
    private static MAX_CACHE_SIZE;
    private static resetMessageHistory;
    private static getMessageId;
    private static wrapCallbackWithCache;
    static setObserversForChain: (waku: Optional<LightNode>, chain: Chain) => Promise<void>;
    static resetCurrentChain: () => void;
    static checkSubscriptionsHealth: (waku: Optional<LightNode>) => Promise<void>;
    static unsubscribe(waku: Optional<LightNode>): Promise<void>;
    private static removeAllObservers;
    private static getDecodersForChain;
    private static addChainObservers;
    static addTransportSubscription(waku: Optional<LightNode>, topic: string, callback: (message: any) => void): Promise<void>;
    private static addSubscriptions;
    static getCurrentContentTopics(): string[];
    static getLastMessage(topic: string): IDecodedMessage | undefined;
    static getCallbackForTopic(topic: string): Optional<(message: any) => void>;
}
