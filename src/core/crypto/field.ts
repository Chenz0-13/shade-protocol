import { randomBytes } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { BN128_FIELD, MAX_VALUE, VALUE_BITS } from "../constants.js";

export function assertField(name: string, value: bigint): void {
  if (value < 0n || value >= BN128_FIELD) {
    throw new Error(`${name} is outside the BN128 scalar field`);
  }
}

export function assertValue(name: string, value: bigint): void {
  if (value < 0n || value > MAX_VALUE) {
    throw new Error(`${name} must fit in ${VALUE_BITS} bits`);
  }
}

export function bytesToBigint(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const byte of bytes) out = (out << 8n) + BigInt(byte);
  return out;
}

export function fieldToBe32(value: bigint): Uint8Array {
  assertField("value", value);
  const out = new Uint8Array(32);
  let current = value;
  for (let index = 31; index >= 0; index -= 1) {
    out[index] = Number(current & 0xffn);
    current >>= 8n;
  }
  return out;
}

/** 31 random bytes is 248 bits, strictly below the 254-bit field prime. */
export function randomField(): bigint {
  return bytesToBigint(randomBytes(31));
}

export function randomNonZeroField(): bigint {
  let value = 0n;
  while (value === 0n) value = randomField();
  return value;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error("invalid hex");
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}

export function sha256ToField(data: Uint8Array): bigint {
  return bytesToBigint(sha256(data)) % BN128_FIELD;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!;
  return diff === 0;
}
