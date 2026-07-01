import { type IMessage } from '@waku/sdk';
export type WakuTransactResponse = {
    id: string;
    txHash?: string;
    error?: string;
};
export declare class BroadcasterTransactResponse {
    static storedTransactionResponse: Optional<WakuTransactResponse>;
    static sharedKey: Optional<Uint8Array>;
    static setSharedKey: (key: Uint8Array) => void;
    static clearSharedKey: () => void;
    static handleBroadcasterTransactionResponseMessage(message: IMessage): Promise<void>;
}
