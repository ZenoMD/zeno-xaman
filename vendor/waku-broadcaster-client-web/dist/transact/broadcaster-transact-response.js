import { decryptAESGCM256 } from '@railgun-community/wallet';
import { bytesToUtf8 } from '../utils/conversion.js';
import { BroadcasterDebug } from '../utils/broadcaster-debug.js';
import { isDefined } from '../utils/is-defined.js';
export class BroadcasterTransactResponse {
    static storedTransactionResponse;
    static sharedKey;
    static setSharedKey = (key) => {
        BroadcasterTransactResponse.sharedKey = key;
        BroadcasterTransactResponse.storedTransactionResponse = undefined;
    };
    static clearSharedKey = () => {
        BroadcasterTransactResponse.sharedKey = undefined;
        BroadcasterTransactResponse.storedTransactionResponse = undefined;
    };
    static async handleBroadcasterTransactionResponseMessage(message) {
        BroadcasterDebug.log('Transact Response received.');
        if (!BroadcasterTransactResponse.sharedKey) {
            return;
        }
        if (!isDefined(message.payload)) {
            return;
        }
        try {
            const payload = bytesToUtf8(message.payload);
            const { result: encryptedData } = JSON.parse(payload);
            const decrypted = decryptAESGCM256(encryptedData, BroadcasterTransactResponse.sharedKey);
            if (decrypted == null) {
                return;
            }
            BroadcasterDebug.log('Handle Broadcaster transact-response message:');
            BroadcasterDebug.log(JSON.stringify(decrypted));
            BroadcasterTransactResponse.storedTransactionResponse =
                decrypted;
        }
        catch (cause) {
            if (!(cause instanceof Error)) {
                throw new Error('Unexpected non-error thrown', { cause });
            }
            BroadcasterDebug.error(new Error('Could not handle Broadcaster tx response message', {
                cause,
            }));
        }
    }
}
//# sourceMappingURL=broadcaster-transact-response.js.map