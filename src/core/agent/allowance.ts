import { DOMAIN, TREE_DEPTH } from "../constants.js";
import { assertValue } from "../crypto/field.js";
import { assetChainTag, noteNullifier, ownerAddress } from "../crypto/note.js";
import { poseidon } from "../crypto/poseidon.js";
import { pathIndex } from "../proof/witness.js";

export interface AllowanceOpening {
  value: bigint;
  cap: bigint;
  expiry: bigint;
  blinding: bigint;
  rho: bigint;
  spendingKey: bigint;
  assetId: bigint;
  chainHome: bigint;
}

/** Commitment that binds the spend cap and expiry into the note. */
export function allowanceCommitment(parts: AllowanceOpening): bigint {
  assertValue("value", parts.value);
  assertValue("cap", parts.cap);
  assertValue("expiry", parts.expiry);
  const policy = poseidon([DOMAIN.allowance, parts.cap, parts.expiry]);
  const packed = poseidon([assetChainTag(parts.assetId, parts.chainHome), policy]);
  return poseidon([
    DOMAIN.commitment,
    parts.value,
    parts.blinding,
    parts.rho,
    ownerAddress(parts.spendingKey),
    packed,
  ]);
}

/**
 * x402-style check. Expiry is a timestamp the caller supplies as `now`.
 * A verifier that ignores `now` can still accept a saved receipt. The circuit
 * rejects a witness whose `now` is after `expiry` or whose amount exceeds the cap.
 */
export function assertAllowancePayment(parts: AllowanceOpening, amount: bigint, now: bigint): void {
  assertValue("amount", amount);
  assertValue("now", now);
  if (amount > parts.cap) throw new Error("payment exceeds the allowance cap");
  if (amount > parts.value) throw new Error("payment exceeds the note value");
  if (now > parts.expiry) throw new Error("allowance has expired");
}

export function allowanceNullifier(parts: AllowanceOpening, commitment: bigint, leafIndex: bigint): bigint {
  return noteNullifier(parts.spendingKey, commitment, leafIndex);
}

export function buildAllowanceWitness(input: {
  opening: AllowanceOpening;
  amount: bigint;
  now: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
}): Record<string, string | string[]> {
  if (input.pathElements.length !== TREE_DEPTH || input.pathIndices.length !== TREE_DEPTH) {
    throw new Error(`Merkle path must have depth ${TREE_DEPTH}`);
  }
  assertAllowancePayment(input.opening, input.amount, input.now);
  const commitment = allowanceCommitment(input.opening);
  const leaf = pathIndex(input.pathIndices);
  const nullifier = allowanceNullifier(input.opening, commitment, leaf);
  return {
    merkleRoot: input.root.toString(),
    nullifierHash: nullifier.toString(),
    amount: input.amount.toString(),
    now: input.now.toString(),
    expiry: input.opening.expiry.toString(),
    value: input.opening.value.toString(),
    cap: input.opening.cap.toString(),
    blinding: input.opening.blinding.toString(),
    rho: input.opening.rho.toString(),
    assetId: input.opening.assetId.toString(),
    chainHome: input.opening.chainHome.toString(),
    spendingKey: input.opening.spendingKey.toString(),
    pathElements: input.pathElements.map((item) => item.toString()),
    pathIndices: input.pathIndices.map((item) => item.toString()),
  };
}

/** Builds the public payment a client would attach to an x402 challenge. No live x402 call is made. */
export function x402Payment(parts: AllowanceOpening, amount: bigint, now: bigint, resource: string, leafIndex: bigint) {
  assertAllowancePayment(parts, amount, now);
  const commitment = allowanceCommitment(parts);
  return {
    resource,
    amount: amount.toString(),
    now: now.toString(),
    expiry: parts.expiry.toString(),
    commitment: commitment.toString(),
    nullifier: allowanceNullifier(parts, commitment, leafIndex).toString(),
  };
}
