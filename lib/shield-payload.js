import { ShieldNoteERC20, RailgunEngine, ByteUtils } from "@railgun-community/engine";
import { AbiCoder } from "ethers";

// The GMP payload our AxelarPoolRouter expects. The router builds the full
// ShieldRequest from the token + amount the bridge actually delivered, so the
// payload only carries the recipient-specific fields it can't derive: the note
// public key and the shield ciphertext. This matches the contract's struct:
//
//   struct ShieldNoteData   { bytes32 npk; ShieldCiphertext ciphertext; }
//   struct ShieldCiphertext { bytes32[3] encryptedBundle; bytes32 shieldKey; }
//
// We still build a RAILGUN note (note/shield-note.js → serialize) the same way
// the wallet SDK does, then take only npk + ciphertext from it. npk and the
// ciphertext depend on the receiver keys + `random`, not on the token/value, so
// the value the router fills in on-chain is recovered correctly on scan.
const SHIELD_NOTE_DATA_ABI =
  "tuple(bytes32 npk, tuple(bytes32[3] encryptedBundle, bytes32 shieldKey) ciphertext)";

// Token/value are placeholders: serialize() needs them to construct the note,
// but neither is part of the emitted payload (the router sets the real values).
const PLACEHOLDER_TOKEN = "0x0000000000000000000000000000000000000000";
const PLACEHOLDER_VALUE = 1n;

/**
 * Build the ABI-encoded `ShieldNoteData` payload that lets the router shield to
 * `railgunAddress` (a 0zk address) whatever amount it receives from the bridge.
 *
 * @returns {Promise<string>} 0x-prefixed ABI-encoded bytes
 */
export async function buildShieldPayload({ railgunAddress }) {
  const { masterPublicKey, viewingPublicKey } =
    RailgunEngine.decodeAddress(railgunAddress);

  // `random` ties the note to its commitment; `shieldPrivateKey` is the
  // ephemeral key the shield ciphertext is sealed with. Both are throwaway —
  // the receiver recovers the note from its viewing key during the scan — so a
  // fresh random value per shield is all that's needed.
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
