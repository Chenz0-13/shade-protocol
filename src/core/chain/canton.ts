import { NotImplementedError } from "../errors.js";

/**
 * Canton cannot verify this Groth16 circuit.
 *
 * Public DevNet requires a Super Validator sponsor and an egress-IP allowlist,
 * and it is reset on a fixed cadence. LocalNet (cn-quickstart) is a Docker
 * stack, not something this process can assume is running. More importantly,
 * Daml has no BN254 pairing or alt_bn128 precompile, so a sandbox choice that
 * "accepts" a proof would be recording an unchecked blob. The adapter refuses
 * that.
 */
export function submitCanton(): never {
  throw new NotImplementedError(
    "Canton shielded submission. Daml has no BN254 pairing, and Canton DevNet requires a Super Validator sponsor plus an IP allowlist. Refusing to record an unverified Groth16 proof.",
  );
}
