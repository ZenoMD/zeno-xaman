import { Chain } from '@railgun-community/shared-models';
import { type IMessage } from '@waku/sdk';
export declare const handleBroadcasterFeesMessage: (chain: Chain, message: IMessage, contentTopic: string) => Promise<void>;
