import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groth16, type Groth16Proof } from "snarkjs";
import { ProofError } from "../errors.js";
import { buildTransferWitness, type TransferWitnessInput } from "./witness.js";

export type { Groth16Proof };

export interface ArtifactPaths {
  wasm: string;
  zkey: string;
  vkey: string;
}

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function artifactPaths(root = repoRoot()): ArtifactPaths {
  const build = path.join(root, "circuits", "build");
  return {
    wasm: path.join(build, "shielded_transfer_js", "shielded_transfer.wasm"),
    zkey: path.join(build, "shielded_transfer_final.zkey"),
    vkey: path.join(build, "verification_key.json"),
  };
}

export class ShieldedTransferProver {
  private constructor(
    private readonly wasm: string,
    private readonly zkey: string,
    private readonly verificationKey: object,
  ) {}

  static load(root = repoRoot()): ShieldedTransferProver {
    const paths = artifactPaths(root);
    const missing = [paths.wasm, paths.zkey, paths.vkey].filter((file) => !existsSync(file));
    if (missing.length > 0) {
      throw new ProofError(
        `Missing circuit artifact ${missing[0]}. Run npm run circuit:setup. Refusing to use a mock proof.`,
      );
    }
    const verificationKey = JSON.parse(readFileSync(paths.vkey, "utf8")) as object;
    return new ShieldedTransferProver(paths.wasm, paths.zkey, verificationKey);
  }

  async prove(input: TransferWitnessInput): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
    const built = buildTransferWitness(input);
    const result = await this.proveCircuit(built.witness);
    if (result.publicSignals.join(",") !== built.publicSignals.join(",")) {
      throw new ProofError(
        `prover public signals did not match the witness: ${result.publicSignals.join(",")} vs ${built.publicSignals.join(",")}`,
      );
    }
    return result;
  }

  /** Runs Groth16 on a witness. Invalid constraints throw instead of producing a proof. */
  async proveCircuit(
    witness: Record<string, string | string[]>,
  ): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
    try {
      return await groth16.fullProve(witness, this.wasm, this.zkey);
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("\n")[0] : "proof generation failed";
      throw new ProofError(`witness does not satisfy the shielded transfer circuit (${detail})`);
    }
  }

  async verify(proof: Groth16Proof, publicSignals: readonly string[]): Promise<boolean> {
    try {
      return await groth16.verify(this.verificationKey, [...publicSignals], proof);
    } catch {
      return false;
    }
  }
}
