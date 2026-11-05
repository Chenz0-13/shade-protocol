import { DOMAIN } from "../constants.js";
import { assertField, assertValue } from "./field.js";
import { poseidon } from "./poseidon.js";

export interface NoteParts {
  value: bigint;
  blinding: bigint;
  rho: bigint;
  ownerPub: bigint;
  assetId: bigint;
  /** Chain that minted the note. Mixed into the commitment so a note is not fungible across chains. */
  chainHome: bigint;
}

/** Public address bound into a note. Hides the spending key. */
export function ownerAddress(spendingKey: bigint): bigint {
  assertField("spendingKey", spendingKey);
  return poseidon([DOMAIN.owner, spendingKey]);
}

/**
 * Domain-tagged asset and chain tag. Poseidon(assetDomain, assetId) and
 * Poseidon(chainDomain, chainHome) are mixed with one more Poseidon so the
 * commitment can stay a 6-input hash on every chain.
 */
export function assetChainTag(assetId: bigint, chainHome: bigint): bigint {
  assertField("assetId", assetId);
  assertField("chainHome", chainHome);
  return poseidon([poseidon([DOMAIN.asset, assetId]), poseidon([DOMAIN.chain, chainHome])]);
}

/**
 * Hash commitment. The blinding factor and rho hide the value, asset, chain,
 * and owner, and bind the commitment to that opening.
 */
export function noteCommitment(parts: NoteParts): bigint {
  assertValue("value", parts.value);
  assertField("blinding", parts.blinding);
  assertField("rho", parts.rho);
  assertField("ownerPub", parts.ownerPub);
  return poseidon([
    DOMAIN.commitment,
    parts.value,
    parts.blinding,
    parts.rho,
    parts.ownerPub,
    assetChainTag(parts.assetId, parts.chainHome),
  ]);
}

export function commitmentOpens(commitment: bigint, parts: NoteParts): boolean {
  return noteCommitment(parts) === commitment;
}

/**
 * Nullifier = Poseidon(domain, spending key, commitment, leaf index).
 *
 * A nullifier that depended only on the spending key and rho would be shared
 * by two notes that reused rho. Spending one would freeze the other. The
 * commitment and the leaf index make each tree position distinct.
 */
export function noteNullifier(spendingKey: bigint, commitment: bigint, leafIndex: bigint): bigint {
  assertField("spendingKey", spendingKey);
  assertField("commitment", commitment);
  assertField("leafIndex", leafIndex);
  return poseidon([DOMAIN.nullifier, spendingKey, commitment, leafIndex]);
}

/**
 * Output rho is derived from the input nullifier, so a spend cannot choose
 * an output rho. Index 1 is the first output and index 2 is the change note.
 */
export function deriveOutputRho(nullifier: bigint, outputIndex: bigint): bigint {
  assertField("nullifier", nullifier);
  assertField("outputIndex", outputIndex);
  return poseidon([DOMAIN.rho, nullifier, outputIndex]);
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

