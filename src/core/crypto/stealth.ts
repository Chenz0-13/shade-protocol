import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesEqual, bytesToBigint, utf8 } from "./field.js";

const SALT = sha256(utf8("shade.hkdf.salt.v1"));
const ORDER = secp256k1.Point.Fn.ORDER;

export interface CurveKeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface StealthAddress {
  /** One-time public key: spendPub + H(ECDH(ephemeral, viewPub))·G. */
  stealthPublicKey: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  /** Sender-side only. Never publish this. */
  ephemeralSecretKey: Uint8Array;
}

export function generateCurveKeyPair(): CurveKeyPair {
  const secretKey = secp256k1.utils.randomSecretKey();
  return { secretKey, publicKey: secp256k1.getPublicKey(secretKey, true) };
}

export function sharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return secp256k1.getSharedSecret(secretKey, peerPublicKey, true);
}

function hkdfInfo(info: string, ikm: Uint8Array, length = 32): Uint8Array {
  return hkdf(sha256, ikm, SALT, utf8(info), length);
}

/** AES-256 key. Derived from the ECDH shared secret, not from raw key bytes. */
export function noteEncryptionKey(shared: Uint8Array): Uint8Array {
  return hkdfInfo("shade.note.enc.v1", shared);
}

export function regulatorEncryptionKey(shared: Uint8Array): Uint8Array {
  return hkdfInfo("shade.regulator.enc.v1", shared);
}

function tweakScalar(shared: Uint8Array): bigint {
  const reduced = bytesToBigint(hkdfInfo("shade.stealth.tweak.v1", shared)) % ORDER;
  if (reduced === 0n) throw new Error("stealth tweak collapsed to zero");
  return reduced;
}

function compressed(point: ReturnType<typeof secp256k1.Point.fromBytes>): Uint8Array {
  return (point as { toBytes(compressed?: boolean): Uint8Array }).toBytes(true);
}

/**
 * Dual-key stealth address. The sender knows the recipient's spend and view
 * public keys. The one-time address is unlinkable to the spend key without
 * the view key. The view key recognizes the address; spending the curve point
 * also requires the long-term spend scalar.
 *
 * The ZK spending key is a separate field element. Poseidon is not homomorphic,
 * so the circuit commits to Poseidon(spendingKey), which the sender already
 * knows as the recipient's public owner address. The view key cannot derive it.
 */
export function deriveStealthAddress(
  spendPublicKey: Uint8Array,
  viewPublicKey: Uint8Array,
  ephemeralSecretKey: Uint8Array = secp256k1.utils.randomSecretKey(),
): StealthAddress {
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecretKey, true);
  const tweak = tweakScalar(sharedSecret(ephemeralSecretKey, viewPublicKey));
  const stealth = secp256k1.Point.fromBytes(spendPublicKey).add(secp256k1.Point.BASE.multiply(tweak));
  return {
    stealthPublicKey: compressed(stealth),
    ephemeralPublicKey,
    ephemeralSecretKey,
  };
}

export function recognizeStealthAddress(
  viewPrivateKey: Uint8Array,
  spendPublicKey: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  stealthPublicKey: Uint8Array,
): boolean {
  const tweak = tweakScalar(sharedSecret(viewPrivateKey, ephemeralPublicKey));
  const expected = secp256k1.Point.fromBytes(spendPublicKey).add(secp256k1.Point.BASE.multiply(tweak));
  return bytesEqual(compressed(expected), stealthPublicKey);
}

/** One-time curve scalar. Requires the spend secret; the view key is not enough. */
export function deriveStealthPrivateKey(
  spendPrivateKey: Uint8Array,
  viewPrivateKey: Uint8Array,
  ephemeralPublicKey: Uint8Array,
): Uint8Array {
  const tweak = tweakScalar(sharedSecret(viewPrivateKey, ephemeralPublicKey));
  const spend = secp256k1.Point.Fn.fromBytes(spendPrivateKey);
  const oneTime = modOrder(spend + tweak);
  return secp256k1.Point.Fn.toBytes(oneTime);
}

function modOrder(value: bigint): bigint {
  const reduced = value % ORDER;
  return reduced >= 0n ? reduced : reduced + ORDER;
}
