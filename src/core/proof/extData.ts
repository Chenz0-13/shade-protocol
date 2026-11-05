import { sha256 } from "@noble/hashes/sha2.js";
import { DOMAIN } from "../constants.js";
import { bytesToBigint } from "../crypto/field.js";
import { poseidon } from "../crypto/poseidon.js";

/**
 * Recipient, relayer, and the pool that must accept the proof.
 * The pool address is part of the domain binder, so a proof for one
 * deployment does not authorize a payout from another.
 */
export interface ExtDataLimbs {
  recipientLo: bigint;
  recipientHi: bigint;
  relayerLo: bigint;
  relayerHi: bigint;
  poolLo: bigint;
  poolHi: bigint;
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

export function extDataHash(limbs: ExtDataLimbs, withdrawAmount: bigint, relayerFee: bigint): bigint {
  const binder = poseidon([
    DOMAIN.ext,
    limbs.poolLo,
    limbs.poolHi,
    limbs.chainDomain,
    withdrawAmount,
    relayerFee,
  ]);
  return poseidon([
    limbs.recipientLo,
    limbs.recipientHi,
    limbs.relayerLo,
    limbs.relayerHi,
    binder,
    0n,
  ]);
}
