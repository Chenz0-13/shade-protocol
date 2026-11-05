import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToBigint } from "../crypto/field.js";
import { poseidon } from "../crypto/poseidon.js";

/** Poseidon(recipientLo, recipientHi, relayerLo, relayerHi, fee, chainDomain). */
export interface ExtDataLimbs {
  recipientLo: bigint;
  recipientHi: bigint;
  relayerLo: bigint;
  relayerHi: bigint;
  chainDomain: bigint;
}

const MASK128 = (1n << 128n) - 1n;

export function split128(value: bigint): [bigint, bigint] {
  if (value < 0n || value >= 1n << 256n) throw new Error("external data integer must fit in 256 bits");
  return [value & MASK128, value >> 128n];
}

/** 32-byte big-endian key. High limb is the first 16 bytes. */
export function limbsFrom32(bytes: Uint8Array): [bigint, bigint] {
  if (bytes.length !== 32) throw new Error("external data key must be 32 bytes");
  return [bytesToBigint(bytes.subarray(16)), bytesToBigint(bytes.subarray(0, 16))];
}

export function limbsFromEvmAddress(address: `0x${string}` | string): [bigint, bigint] {
  return split128(BigInt(address));
}

export function limbsFromAccount(account: string): [bigint, bigint] {
  return limbsFrom32(sha256(new TextEncoder().encode(account)));
}

export function extDataHash(limbs: ExtDataLimbs, fee: bigint): bigint {
  return poseidon([
    limbs.recipientLo,
    limbs.recipientHi,
    limbs.relayerLo,
    limbs.relayerHi,
    fee,
    limbs.chainDomain,
  ]);
}
