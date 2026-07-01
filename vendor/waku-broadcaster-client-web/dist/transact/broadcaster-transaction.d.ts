import { Chain, PreTransactionPOIsPerTxidLeafPerList, TXIDVersion } from '@railgun-community/shared-models';
export declare class BroadcasterTransaction {
    private messageData;
    private contentTopic;
    private txidVersionForInputs;
    private chain;
    private nullifiers;
    private constructor();
    static create(txidVersionForInputs: TXIDVersion, to: string, data: string, broadcasterRailgunAddress: string, broadcasterFeesID: string, chain: Chain, nullifiers: string[], overallBatchMinGasPrice: bigint, useRelayAdapt: boolean, preTransactionPOIsPerTxidLeafPerList: PreTransactionPOIsPerTxidLeafPerList): Promise<BroadcasterTransaction>;
    private static encryptTransaction;
    private findMatchingNullifierTxid;
    private getTransactionResponse;
    private getBroadcastRetryState;
    send(): Promise<string>;
    private broadcast;
}
