import { DOMAIN } from "../constants.js";
import { assertField, assertValue } from "./field.js";
import { poseidon } from "./poseidon.js";

export interface NoteParts {
  value: bigint;
  blinding: bigint;
  rho: bigint;
  ownerPub: bigint;
  assetId: bigint;
}

/** Public address bound into a note. Hides the spending key. */
export function ownerAddress(spendingKey: bigint): bigint {
  assertField("spendingKey", spendingKey);
  return poseidon([DOMAIN.owner, spendingKey]);
}

/**
 * Hash commitment. The blinding factor and rho hide the value, asset, and
 * owner, and bind the commitment to that opening.
 */
export function noteCommitment(parts: NoteParts): bigint {
  assertValue("value", parts.value);
  assertField("blinding", parts.blinding);
  assertField("rho", parts.rho);
  assertField("ownerPub", parts.ownerPub);
  assertField("assetId", parts.assetId);
  return poseidon([
    DOMAIN.commitment,
    parts.value,
    parts.blinding,
    parts.rho,
    parts.ownerPub,
    parts.assetId,
  ]);
}

export function commitmentOpens(commitment: bigint, parts: NoteParts): boolean {
  return noteCommitment(parts) === commitment;
}

/**
 * Unique per note for a spending key because rho is a fresh field element
 * committed inside the note. The same opening always reproduces it.
 */
export function noteNullifier(spendingKey: bigint, rho: bigint): bigint {
  assertField("spendingKey", spendingKey);
  assertField("rho", rho);
  return poseidon([DOMAIN.nullifier, spendingKey, rho]);
}

export function orderBinding(parts: {
  noteCommitment: bigint;
  side: bigint;
  priceMin: bigint;
  priceMax: bigint;
  amount: bigint;
}): bigint {
  assertField("noteCommitment", parts.noteCommitment);
  assertField("side", parts.side);
  assertValue("priceMin", parts.priceMin);
  assertValue("priceMax", parts.priceMax);
  assertValue("amount", parts.amount);
  return poseidon([
    DOMAIN.order,
    parts.noteCommitment,
    parts.side,
    parts.priceMin,
    parts.priceMax,
    parts.amount,
  ]);
}

