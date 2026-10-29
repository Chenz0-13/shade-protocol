import { beforeAll, describe, expect, it } from "vitest";
import { ASSET_BASE } from "../src/core/constants.js";
import { randomNonZeroField } from "../src/core/crypto/field.js";
import { generatePrivacyKeys } from "../src/core/crypto/keys.js";
import { noteCommitment } from "../src/core/crypto/note.js";
import { MerkleTree } from "../src/core/merkle/MerkleTree.js";
import { ShieldedTransferProver } from "../src/core/proof/ShieldedTransferProver.js";
import { buildTransferWitness, type TransferOutput, type TransferWitnessInput } from "../src/core/proof/witness.js";
import { ProofError } from "../src/core/errors.js";

function sample(): { input: TransferWitnessInput; commitment: bigint } {
  const owner = generatePrivacyKeys();
  const recipient = generatePrivacyKeys();
  const blinding = randomNonZeroField();
  const rho = randomNonZeroField();
  const commitment = noteCommitment({
    value: 100n,
    blinding,
    rho,
    ownerPub: owner.ownerPub,
    assetId: ASSET_BASE,
  });
  const tree = MerkleTree.empty();
  const index = tree.insert(commitment);
  const proof = tree.getProof(index);
  const out1: TransferOutput = {
    value: 60n,
    blinding: randomNonZeroField(),
    rho: randomNonZeroField(),
    ownerPub: recipient.ownerPub,
    assetId: ASSET_BASE,
  };
  const out2: TransferOutput = {
    value: 40n,
    blinding: randomNonZeroField(),
    rho: randomNonZeroField(),
    ownerPub: owner.ownerPub,
    assetId: ASSET_BASE,
  };
  return {
    commitment,
    input: {
      root: proof.root,
      spendingKey: owner.spendingKey,
      valueIn: 100n,
      blindingIn: blinding,
      rhoIn: rho,
      assetIn: ASSET_BASE,
      pathElements: proof.pathElements,
      pathIndices: proof.pathIndices,
      fee: 0n,
      out1,
      out2,
    },
  };
}

describe("shielded transfer proofs", () => {
  let prover: ShieldedTransferProver;

  beforeAll(() => {
    prover = ShieldedTransferProver.load();
  });

  it("accepts a real proof and rejects a tampered proof or public input", async () => {
    const { input } = sample();
    const { proof, publicSignals } = await prover.prove(input);
    expect(await prover.verify(proof, publicSignals)).toBe(true);

    const wrongRoot = [...publicSignals];
    wrongRoot[0] = (BigInt(wrongRoot[0]!) + 1n).toString();
    expect(await prover.verify(proof, wrongRoot)).toBe(false);

    const broken = {
      ...proof,
      pi_a: [...proof.pi_a],
    };
    broken.pi_a[0] = "1";
    expect(await prover.verify(broken, publicSignals)).toBe(false);
  });

  it("rejects a forged Merkle path and a value that does not conserve", async () => {
    const { input } = sample();
    const forged = buildTransferWitness({
      ...input,
      pathElements: [input.pathElements[0]! + 1n, ...input.pathElements.slice(1)],
    });
    await expect(prover.proveCircuit(forged.witness)).rejects.toBeInstanceOf(ProofError);

    const unbalanced = buildTransferWitness(input);
    const inflated = BigInt(unbalanced.witness.valueOut1 as string) + 1n;
    unbalanced.witness.valueOut1 = inflated.toString();
    unbalanced.witness.commitmentOut1 = noteCommitment({
      value: inflated,
      blinding: BigInt(unbalanced.witness.blindingOut1 as string),
      rho: BigInt(unbalanced.witness.rhoOut1 as string),
      ownerPub: BigInt(unbalanced.witness.ownerOut1 as string),
      assetId: ASSET_BASE,
    }).toString();
    await expect(prover.proveCircuit(unbalanced.witness)).rejects.toBeInstanceOf(ProofError);
  });
});
