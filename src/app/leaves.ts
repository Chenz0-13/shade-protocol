import { keccak_256 } from "@noble/hashes/sha3.js";
import { ASSET_BASE, EXT_DOMAIN } from "../core/constants.js";
import { bytesToHex, utf8 } from "../core/crypto/field.js";
import { noteCommitment } from "../core/crypto/note.js";
import { readBe, readU64LE } from "./bytes.js";

/** `SHADEpl2` is the magic on the deployed Solana devnet pool. `SHADEpl1` is the copy in this repository. */
export const POOL_MAGICS = ["SHADEpl1", "SHADEpl2"] as const;
export const POOL_MAGIC = POOL_MAGICS[0];
export const POOL_NEXT_INDEX_OFFSET = 12;
export const POOL_ROOT_OFFSET = 20;
export const DEPOSIT_IX_LEN = 105;
export const WITHDRAW_IX_LEN = 481;

const depositTopicBytes = keccak_256(utf8("Deposited(uint256,uint256,uint256,uint256)"));
const spentTopicBytes = keccak_256(utf8("Spent(uint256,uint256,uint256,uint256,uint256,uint256)"));

export const DEPOSIT_TOPIC = bytesToHex(depositTopicBytes);
export const SPENT_TOPIC = bytesToHex(spentTopicBytes);

export interface PoolHeader {
  nextIndex: bigint;
  root: bigint;
}

export function readPoolHeader(data: Uint8Array): PoolHeader {
  if (data.length < POOL_ROOT_OFFSET + 32) throw new Error("Pool account is too small.");
  const magic = new TextDecoder().decode(data.subarray(0, 8));
  if (!POOL_MAGICS.includes(magic as (typeof POOL_MAGICS)[number])) {
    throw new Error("This account is not a Shader pool.");
  }
  return {
    nextIndex: readU64LE(data, POOL_NEXT_INDEX_OFFSET),
    root: readBe(data.subarray(POOL_ROOT_OFFSET, POOL_ROOT_OFFSET + 32)),
  };
}

/** Commitments inserted by one Solana instruction, in chain order. Unknown instructions add nothing. */
export function leavesFromInstruction(data: Uint8Array): bigint[] {
  if (data.length === DEPOSIT_IX_LEN && data[0] === 2) {
    return [
      noteCommitment({
        value: readU64LE(data, 97),
        blinding: readBe(data.subarray(1, 33)),
        rho: readBe(data.subarray(33, 65)),
        ownerPub: readBe(data.subarray(65, 97)),
        assetId: ASSET_BASE,
        chainHome: EXT_DOMAIN.solana,
      }),
    ];
  }
  if (data.length === WITHDRAW_IX_LEN && data[0] === 1) {
    return [readBe(data.subarray(321, 353)), readBe(data.subarray(353, 385))];
  }
  return [];
}

export interface EvmPoolLog {
  topic0: string;
  topic1: string;
  data: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
}

/** Commitments inserted by deposit and spend logs, oldest first. */
export function leavesFromEvmLogs(logs: readonly EvmPoolLog[]): bigint[] {
  const ordered = [...logs].sort(
    (left, right) =>
      left.blockNumber - right.blockNumber ||
      left.transactionIndex - right.transactionIndex ||
      left.logIndex - right.logIndex,
  );
  const leaves: bigint[] = [];
  for (const log of ordered) {
    const topic0 = strip0x(log.topic0).toLowerCase();
    if (topic0 === DEPOSIT_TOPIC) {
      leaves.push(BigInt(`0x${strip0x(log.topic1)}`));
      continue;
    }
    if (topic0 === SPENT_TOPIC) {
      const words = hexWords(log.data);
      if (words.length < 2) throw new Error("A pool log was missing its output notes.");
      leaves.push(words[0]!, words[1]!);
    }
  }
  return leaves;
}

function strip0x(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function hexWords(data: string): bigint[] {
  const hex = strip0x(data);
  if (hex.length % 64 !== 0) throw new Error("A pool log was the wrong size.");
  const words: bigint[] = [];
  for (let offset = 0; offset < hex.length; offset += 64) {
    words.push(BigInt(`0x${hex.slice(offset, offset + 64)}`));
  }
  return words;
}
