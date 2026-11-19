import { secp256k1 } from "@noble/curves/secp256k1.js";
import { BN128_FIELD } from "../core/constants.js";
import { bytesToHex, hexToBytes } from "../core/crypto/field.js";
import { base64UrlToBytes, bytesToBase64Url } from "./bytes.js";

const PREFIX = "shader:";

export interface ShieldedAddress {
  ownerPub: bigint;
  viewPublicKey: Uint8Array;
  spendPublicKey: Uint8Array;
}

/** A shielded address is not a wallet address. It is the public identity of a note owner. */
export function formatShieldedAddress(identity: ShieldedAddress): string {
  assertShieldedAddress(identity);
  const json = JSON.stringify({
    v: 1,
    o: identity.ownerPub.toString(),
    w: bytesToHex(identity.viewPublicKey),
    s: bytesToHex(identity.spendPublicKey),
  });
  return PREFIX + bytesToBase64Url(new TextEncoder().encode(json));
}

export function parseShieldedAddress(value: string): ShieldedAddress {
  const trimmed = value.trim();
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error("Paste a shielded address. It starts with shader: and is not a normal wallet address.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(trimmed.slice(PREFIX.length))));
  } catch {
    throw new Error("That shielded address could not be read.");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("That shielded address could not be read.");
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || typeof record.o !== "string" || typeof record.w !== "string" || typeof record.s !== "string") {
    throw new Error("That shielded address could not be read.");
  }
  let ownerPub: bigint;
  try {
    ownerPub = BigInt(record.o);
  } catch {
    throw new Error("That shielded address could not be read.");
  }
  const address = {
    ownerPub,
    viewPublicKey: hexToBytes(record.w),
    spendPublicKey: hexToBytes(record.s),
  };
  assertShieldedAddress(address);
  return address;
}

function assertShieldedAddress(identity: ShieldedAddress): void {
  if (identity.ownerPub <= 0n || identity.ownerPub >= BN128_FIELD) {
    throw new Error("That shielded address could not be read.");
  }
  assertCompressedKey(identity.viewPublicKey);
  assertCompressedKey(identity.spendPublicKey);
}

function assertCompressedKey(bytes: Uint8Array): void {
  if (bytes.length !== 33 || (bytes[0] !== 2 && bytes[0] !== 3)) {
    throw new Error("That shielded address could not be read.");
  }
  secp256k1.Point.fromBytes(bytes);
}
