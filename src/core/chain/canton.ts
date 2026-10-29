import { NotImplementedError } from "../errors.js";

/**
 * Canton has no BN254 verifier. The Daml package in `contracts/canton` records
 * a spend only after two named attestors authorize it, and it has no proof
 * field. See `docs/canton-attestation.md`. This process has no participant,
 * so it still refuses to submit.
 */
export function submitCanton(): never {
  throw new NotImplementedError(
    "Canton has no BN254 verifier. Refusing to record an unchecked Groth16 proof. A spend is recorded only as a 2-of-n attestation by the named attestors in contracts/canton. This process has no Canton participant.",
  );
}
