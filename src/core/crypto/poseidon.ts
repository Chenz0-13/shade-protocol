import {
  poseidon1,
  poseidon2,
  poseidon3,
  poseidon4,
  poseidon5,
  poseidon6,
  poseidon7,
} from "poseidon-lite";
import { assertField } from "./field.js";

const HASHERS = [
  undefined,
  poseidon1,
  poseidon2,
  poseidon3,
  poseidon4,
  poseidon5,
  poseidon6,
  poseidon7,
] as const;

/**
 * Poseidon hash matching circomlib's `Poseidon(n)` and poseidon-lite.
 * Inputs are checked against the BN128 field before hashing.
 */
export function poseidon(inputs: readonly bigint[]): bigint {
  const hasher = HASHERS[inputs.length];
  if (!hasher) {
    throw new Error(`Poseidon width ${inputs.length} is not supported`);
  }
  for (const input of inputs) assertField("poseidon input", input);
  return hasher([...inputs]);
}
