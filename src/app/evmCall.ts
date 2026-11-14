import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8 } from "../core/crypto/field.js";
import type { Groth16ProofJson } from "./instruction.js";

const WORD = 32;

export function functionSelector(signature: string): string {
  return bytesToHex(keccak_256(utf8(signature)).subarray(0, 4));
}

export function encodeDepositCall(blinding: bigint, rho: bigint, ownerPub: bigint): string {
  return (
    "0x" +
    functionSelector("deposit(uint256,uint256,uint256)") +
    word(blinding) +
    word(rho) +
    word(ownerPub)
  );
}

/**
 * ABI encoding of ShadePool.shieldedTransfer. Point B is swapped to the
 * Solidity verifier's coordinate order, the same swap `solidityProof` applies.
 */
export function encodeShieldedTransferCall(params: {
  proof: Groth16ProofJson;
  publicSignals: readonly string[];
  recipient: string;
  relayer: string;
}): string {
  if (params.publicSignals.length !== 6) throw new Error("a shielded transfer has six public signals");
  const pA = [BigInt(params.proof.pi_a[0]!), BigInt(params.proof.pi_a[1]!)];
  const pB = [
    BigInt(params.proof.pi_b[0]![1]!),
    BigInt(params.proof.pi_b[0]![0]!),
    BigInt(params.proof.pi_b[1]![1]!),
    BigInt(params.proof.pi_b[1]![0]!),
  ];
  const pC = [BigInt(params.proof.pi_c[0]!), BigInt(params.proof.pi_c[1]!)];
  const words = [
    ...pA,
    ...pB,
    ...pC,
    ...params.publicSignals.map((value) => BigInt(value)),
    BigInt(params.recipient),
    BigInt(params.relayer),
  ];
  return "0x" + functionSelector("shieldedTransfer(uint256[2],uint256[2][2],uint256[2],uint256[6],address,address)") + words.map(word).join("");
}

export function viewCall(signature: string): string {
  return "0x" + functionSelector(signature);
}

export function encodeNullifierQuery(nullifier: bigint): string {
  return "0x" + functionSelector("nullifiers(uint256)") + word(nullifier);
}

function word(value: bigint): string {
  if (value < 0n) throw new Error("ABI word is negative");
  return value.toString(16).padStart(WORD * 2, "0");
}
