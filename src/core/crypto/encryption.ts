import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptionError } from "../errors.js";
import { fieldToBe32, utf8 } from "./field.js";
import { generateCurveKeyPair, noteEncryptionKey, sharedSecret } from "./stealth.js";

export interface SealedBlob {
  ephemeralPublicKey: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
}

export function sealForPublicKey(
  peerPublicKey: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
  deriveKey: (shared: Uint8Array) => Uint8Array = noteEncryptionKey,
  ephemeral: { secretKey: Uint8Array; publicKey: Uint8Array } = generateCurveKeyPair(),
): SealedBlob {
  const key = deriveKey(sharedSecret(ephemeral.secretKey, peerPublicKey));
  return encryptWithKey(ephemeral.publicKey, key, plaintext, aad);
}

export function openWithSecretKey(
  secretKey: Uint8Array,
  blob: SealedBlob,
  aad: Uint8Array,
  deriveKey: (shared: Uint8Array) => Uint8Array = noteEncryptionKey,
): Uint8Array {
  const key = deriveKey(sharedSecret(secretKey, blob.ephemeralPublicKey));
  return decryptWithKey(key, blob, aad);
}

export function noteAad(commitment: bigint): Uint8Array {
  return Buffer.concat([utf8("shade.note.v1|"), fieldToBe32(commitment)]);
}

function encryptWithKey(
  ephemeralPublicKey: Uint8Array,
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): SealedBlob {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return { ephemeralPublicKey, iv, tag: cipher.getAuthTag(), ciphertext };
}

function decryptWithKey(key: Uint8Array, blob: SealedBlob, aad: Uint8Array): Uint8Array {
  try {
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(blob.iv));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(blob.tag));
    return Buffer.concat([decipher.update(Buffer.from(blob.ciphertext)), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

export function serializeSealed(blob: SealedBlob): Buffer {
  if (blob.ephemeralPublicKey.length !== 33 || blob.iv.length !== 12 || blob.tag.length !== 16) {
    throw new Error("sealed blob has unexpected lengths");
  }
  return Buffer.concat([
    Buffer.from([1]),
    Buffer.from(blob.ephemeralPublicKey),
    Buffer.from(blob.iv),
    Buffer.from(blob.tag),
    Buffer.from(blob.ciphertext),
  ]);
}

export function parseSealed(bytes: Uint8Array): SealedBlob {
  if (bytes.length < 1 + 33 + 12 + 16 || bytes[0] !== 1) throw new DecryptionError();
  return {
    ephemeralPublicKey: bytes.subarray(1, 34),
    iv: bytes.subarray(34, 46),
    tag: bytes.subarray(46, 62),
    ciphertext: bytes.subarray(62),
  };
}
