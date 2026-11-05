import { noteAad, openWithSecretKey, parseSealed, sealForPublicKey, serializeSealed } from "../crypto/encryption.js";
import { randomNonZeroField } from "../crypto/field.js";
import type { PrivacyKeys, PublicIdentity } from "../crypto/keys.js";
import { noteCommitment, noteNullifier } from "../crypto/note.js";
import type { NotePlaintext, ShieldedNote } from "../crypto/primitives.js";
import { deriveStealthAddress, recognizeStealthAddress } from "../crypto/stealth.js";
import { decodeNotePlaintext, encodeNotePlaintext } from "../pool/plaintext.js";

export interface OutgoingNote {
  commitment: bigint;
  nullifier: bigint | null;
  encryptedValue: Buffer;
  stealthAddress: string;
  ephemeralPublicKey: Uint8Array;
  assetId: bigint;
  value: bigint;
  blinding: bigint;
  rho: bigint;
  ownerPub: bigint;
}

export function buildOutgoingNote(params: {
  value: bigint;
  assetId: bigint;
  recipient: PublicIdentity;
  memo?: string;
  /** Set when the sender knows the spending key (a note they themselves can spend). */
  spendingKey?: bigint;
}): OutgoingNote {
  const blinding = randomNonZeroField();
  const rho = randomNonZeroField();
  const plaintext: NotePlaintext = {
    value: params.value,
    blinding,
    rho,
    assetId: params.assetId,
    memo: params.memo ?? "",
  };
  const commitment = noteCommitment({
    value: params.value,
    blinding,
    rho,
    ownerPub: params.recipient.ownerPub,
    assetId: params.assetId,
  });
  const stealth = deriveStealthAddress(params.recipient.spendPublicKey, params.recipient.viewPublicKey);
  const encryptedValue = serializeSealed(
    sealForPublicKey(params.recipient.viewPublicKey, encodeNotePlaintext(plaintext), noteAad(commitment), undefined, {
      secretKey: stealth.ephemeralSecretKey,
      publicKey: stealth.ephemeralPublicKey,
    }),
  );
  return {
    commitment,
    nullifier: params.spendingKey === undefined ? null : noteNullifier(params.spendingKey, rho),
    encryptedValue,
    stealthAddress: Buffer.from(stealth.stealthPublicKey).toString("hex"),
    ephemeralPublicKey: stealth.ephemeralPublicKey,
    assetId: params.assetId,
    value: params.value,
    blinding,
    rho,
    ownerPub: params.recipient.ownerPub,
  };
}

export function readNote(keys: PrivacyKeys, note: Pick<OutgoingNote, "encryptedValue" | "commitment" | "stealthAddress">): NotePlaintext {
  const blob = parseSealed(note.encryptedValue);
  const recognized = recognizeStealthAddress(
    keys.viewPrivateKey,
    keys.spendPublicKey,
    blob.ephemeralPublicKey,
    Buffer.from(note.stealthAddress, "hex"),
  );
  if (!recognized) throw new Error("stealth address was not recognized by this view key");
  const plaintext = decodeNotePlaintext(openWithSecretKey(keys.viewPrivateKey, blob, noteAad(note.commitment)));
  return plaintext;
}

export function toShieldedNote(note: OutgoingNote, leafIndex?: number): ShieldedNote {
  return {
    commitment: note.commitment,
    nullifier: note.nullifier,
    encryptedValue: note.encryptedValue,
    stealthAddress: note.stealthAddress,
    assetId: note.assetId,
    leafIndex,
  };
}
