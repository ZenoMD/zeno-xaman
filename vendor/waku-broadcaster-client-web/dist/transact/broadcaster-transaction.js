import { getRailgunWalletAddressData, encryptDataWithSharedKey, getCompletedTxidFromNullifiers, } from '@railgun-community/wallet';
import { poll, BroadcasterTransactRequestType, } from '@railgun-community/shared-models';
import { BroadcasterConfig } from '../models/broadcaster-config.js';
import { bytesToHex } from '../utils/conversion.js';
import { BroadcasterDebug } from '../utils/broadcaster-debug.js';
import { isDefined } from '../utils/is-defined.js';
import { WakuBroadcasterWakuCore } from '../waku/waku-broadcaster-waku-core.js';
import { contentTopics } from '../waku/waku-topics.js';
import { BroadcasterTransactResponse, } from './broadcaster-transact-response.js';
import { getAddress, isHexString } from 'ethers';
var BroadcastRetryState;
(function (BroadcastRetryState) {
    BroadcastRetryState["RetryTransact"] = "RetryTransact";
    BroadcastRetryState["Wait"] = "Wait";
    BroadcastRetryState["Timeout"] = "Timeout";
})(BroadcastRetryState || (BroadcastRetryState = {}));
const SECONDS_PER_RETRY = 2;
const POLL_DELAY_SECONDS = 0.1;
const RETRY_TRANSACTION_SECONDS = 20;
const POST_ALERT_TOTAL_WAITING_SECONDS = 120;
export class BroadcasterTransaction {
    messageData;
    contentTopic;
    txidVersionForInputs;
    chain;
    nullifiers;
    constructor(encryptedDataResponse, txidVersionForInputs, chain, nullifiers) {
        this.messageData = {
            method: 'transact',
            params: {
                pubkey: encryptedDataResponse.randomPubKey,
                encryptedData: encryptedDataResponse.encryptedData,
            },
        };
        this.contentTopic = contentTopics.transact(chain);
        this.txidVersionForInputs = txidVersionForInputs;
        this.chain = chain;
        this.nullifiers = nullifiers;
        BroadcasterTransactResponse.setSharedKey(encryptedDataResponse.sharedKey);
    }
    static async create(txidVersionForInputs, to, data, broadcasterRailgunAddress, broadcasterFeesID, chain, nullifiers, overallBatchMinGasPrice, useRelayAdapt, preTransactionPOIsPerTxidLeafPerList) {
        const encryptedDataResponse = await this.encryptTransaction(txidVersionForInputs, to, data, broadcasterRailgunAddress, broadcasterFeesID, chain, overallBatchMinGasPrice, useRelayAdapt, preTransactionPOIsPerTxidLeafPerList);
        return new BroadcasterTransaction(encryptedDataResponse, txidVersionForInputs, chain, nullifiers);
    }
    static async encryptTransaction(txidVersionForInputs, to, data, broadcasterRailgunAddress, broadcasterFeesID, chain, overallBatchMinGasPrice, useRelayAdapt, preTransactionPOIsPerTxidLeafPerList) {
        if (!isHexString(data)) {
            throw new Error('Data field must be a hex string.');
        }
        const { viewingPublicKey: broadcasterViewingKey } = getRailgunWalletAddressData(broadcasterRailgunAddress);
        const transactData = {
            transactType: BroadcasterTransactRequestType.COMMON,
            txidVersion: txidVersionForInputs,
            to: getAddress(to),
            data,
            broadcasterViewingKey: bytesToHex(broadcasterViewingKey),
            chainID: chain.id,
            chainType: chain.type,
            minGasPrice: overallBatchMinGasPrice.toString(),
            feesID: broadcasterFeesID,
            useRelayAdapt,
            devLog: BroadcasterConfig.IS_DEV,
            minVersion: BroadcasterConfig.MINIMUM_BROADCASTER_VERSION,
            maxVersion: BroadcasterConfig.MAXIMUM_BROADCASTER_VERSION,
            preTransactionPOIsPerTxidLeafPerList,
        };
        const encryptedDataResponse = await encryptDataWithSharedKey(transactData, broadcasterViewingKey);
        return encryptedDataResponse;
    }
    async findMatchingNullifierTxid() {
        try {
            const { txid } = await getCompletedTxidFromNullifiers(this.txidVersionForInputs, this.chain, this.nullifiers);
            return txid;
        }
        catch (cause) {
            if (!(cause instanceof Error)) {
                throw new Error('Unexpected non-error thrown', { cause });
            }
            BroadcasterDebug.error(new Error('Failed to find matching nullifier txid', { cause }));
            return undefined;
        }
    }
    async getTransactionResponse() {
        if (BroadcasterTransactResponse.storedTransactionResponse) {
            return BroadcasterTransactResponse.storedTransactionResponse;
        }
        const nullifiersTxid = await this.findMatchingNullifierTxid();
        if (isDefined(nullifiersTxid)) {
            return {
                id: 'nullifier-transaction',
                txHash: nullifiersTxid,
            };
        }
        return undefined;
    }
    getBroadcastRetryState(retryNumber) {
        const retrySeconds = retryNumber * SECONDS_PER_RETRY;
        if (retrySeconds <= RETRY_TRANSACTION_SECONDS) {
            return BroadcastRetryState.RetryTransact;
        }
        if (retrySeconds >= POST_ALERT_TOTAL_WAITING_SECONDS) {
            return BroadcastRetryState.Timeout;
        }
        return BroadcastRetryState.Wait;
    }
    async send() {
        return this.broadcast();
    }
    async broadcast(retryNumber = 0) {
        const broadcastRetryState = this.getBroadcastRetryState(retryNumber);
        switch (broadcastRetryState) {
            case BroadcastRetryState.RetryTransact:
                BroadcasterDebug.log(`Broadcast Waku message: ${this.messageData.method} via ${this.contentTopic}`);
                try {
                    await WakuBroadcasterWakuCore.broadcastMessage(this.messageData, this.contentTopic);
                }
                catch (err) {
                    if (err instanceof Error) {
                        BroadcasterDebug.log(`Broadcast error: ${err.message}`);
                    }
                }
                break;
            case BroadcastRetryState.Wait:
                break;
            case BroadcastRetryState.Timeout:
                throw new Error('Request timed out.');
        }
        const pollIterations = SECONDS_PER_RETRY / POLL_DELAY_SECONDS;
        const responseTopic = contentTopics.transactResponse(this.chain);
        await WakuBroadcasterWakuCore.retrieveHistoricalForTopic(responseTopic);
        const response = await poll(async () => this.getTransactionResponse(), (result) => result != null, POLL_DELAY_SECONDS * 1000, pollIterations);
        if (isDefined(response)) {
            if (isDefined(response.txHash)) {
                BroadcasterTransactResponse.clearSharedKey();
                return response.txHash;
            }
            if (isDefined(response.error)) {
                BroadcasterDebug.log(`Broadcast error: ${response.error}`);
                BroadcasterTransactResponse.clearSharedKey();
                throw new Error('Received response error from broadcaster.', {
                    cause: new Error(response.error),
                });
            }
        }
        return this.broadcast(retryNumber + 1);
    }
}
//# sourceMappingURL=broadcaster-transaction.js.map