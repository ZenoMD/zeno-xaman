import {
  ShieldNoteERC20,
  RailgunEngine,
  ByteUtils,
} from "@railgun-community/engine";
import { AbiCoder } from "ethers";

const SHIELD_NOTE_DATA_ABI =
  "tuple(bytes32 npk, tuple(bytes32[3] encryptedBundle, bytes32 shieldKey) ciphertext)";
const PLACEHOLDER_TOKEN = "0x0000000000000000000000000000000000000000";
const PLACEHOLDER_VALUE = 1n;

/**
 * Build the ABI-encoded `ShieldNoteData` payload to be sent in an Axelar transfer to the AxelarPoolRouter
 * @returns 0x-prefixed ABI-encoded bytes
 */
export async function buildShieldPayload({
  railgunAddress,
}: {
  railgunAddress: string;
}): Promise<string> {
  const { masterPublicKey, viewingPublicKey } =
    RailgunEngine.decodeAddress(railgunAddress);

  const random = ByteUtils.randomHex(16);
  const shieldPrivateKey = ByteUtils.randomHex(32);

  const note = new ShieldNoteERC20(
    masterPublicKey,
    random,
    PLACEHOLDER_VALUE,
    PLACEHOLDER_TOKEN,
  );
  const shieldRequest = await note.serialize(
    ByteUtils.hexToBytes(shieldPrivateKey),
    viewingPublicKey,
  );

  return AbiCoder.defaultAbiCoder().encode(
    [SHIELD_NOTE_DATA_ABI],
    [{ npk: shieldRequest.preimage.npk, ciphertext: shieldRequest.ciphertext }],
  );
}
