import { PublicKey } from "@solana/web3.js";

const SCALAR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const BASE = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

/** Matches `WITHDRAW_COMPUTE_UNITS` in the Solana adapter. */
export const WITHDRAW_COMPUTE_UNITS = 1_400_000;

export interface Groth16ProofJson {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}

export interface TransferPublicSignals {
  merkleRoot: string;
  nullifier: string;
  commitmentOut1: string;
  commitmentOut2: string;
  withdrawAmount: string;
  relayerFee: string;
  extDataHash: string;
}

export function encodeDepositData(params: {
  blinding: bigint;
  rho: bigint;
  ownerPub: bigint;
  value: bigint;
}): Uint8Array {
  if (params.value <= 0n || params.value > (1n << 64n) - 1n) {
    throw new Error("deposit value is out of range");
  }
  const out = new Uint8Array(105);
  out[0] = 2;
  out.set(be32(params.blinding, SCALAR), 1);
  out.set(be32(params.rho, SCALAR), 33);
  out.set(be32(params.ownerPub, SCALAR), 65);
  new DataView(out.buffer).setBigUint64(97, params.value, true);
  return out;
}

/** Tag 1 layout consumed by the Solana pool: negated A, B, C, then seven public inputs. */
export function encodeWithdrawData(proof: Groth16ProofJson, signals: TransferPublicSignals): Uint8Array {
  const parts = [
    g1(proof.pi_a, true),
    g2(proof.pi_b),
    g1(proof.pi_c, false),
    ...[
      signals.merkleRoot,
      signals.nullifier,
      signals.commitmentOut1,
      signals.commitmentOut2,
      signals.withdrawAmount,
      signals.relayerFee,
      signals.extDataHash,
    ].map((value) => be32(BigInt(value), SCALAR)),
  ];
  const out = new Uint8Array(481);
  out[0] = 1;
  let offset = 1;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function solanaPoolAccounts(programId: PublicKey): { pool: PublicKey; vault: PublicKey } {
  return {
    pool: PublicKey.findProgramAddressSync([new TextEncoder().encode("pool")], programId)[0],
    vault: PublicKey.findProgramAddressSync([new TextEncoder().encode("vault")], programId)[0],
  };
}

export function solanaNullifierAccount(programId: PublicKey, nullifier: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("nullifier"), be32(nullifier, SCALAR)],
    programId,
  )[0];
}

function be32(value: bigint, prime: bigint): Uint8Array {
  if (value < 0n || value >= prime) throw new Error("field element is out of range");
  const out = new Uint8Array(32);
  let current = value;
  for (let index = 31; index >= 0; index -= 1) {
    out[index] = Number(current & 0xffn);
    current >>= 8n;
  }
  return out;
}

function g1(point: string[], negate: boolean): Uint8Array {
  const x = BigInt(point[0] ?? "0");
  let y = BigInt(point[1] ?? "0");
  if (negate && y !== 0n) y = BASE - y;
  return concat(be32(x, BASE), be32(y, BASE));
}

function g2(point: string[][]): Uint8Array {
  const x0 = BigInt(point[0]?.[0] ?? "0");
  const x1 = BigInt(point[0]?.[1] ?? "0");
  const y0 = BigInt(point[1]?.[0] ?? "0");
  const y1 = BigInt(point[1]?.[1] ?? "0");
  return concat(be32(x1, BASE), be32(x0, BASE), be32(y1, BASE), be32(y0, BASE));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
