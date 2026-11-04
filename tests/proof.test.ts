import { beforeAll, describe, expect, it } from "vitest";
import { ASSET_BASE } from "../src/core/constants.js";
import { randomNonZeroField } from "../src/core/crypto/field.js";
import { generatePrivacyKeys } from "../src/core/crypto/keys.js";
import { deriveOutputRho, noteCommitment, noteNullifier, ownerAddress } from "../src/core/crypto/note.js";
import { pathIndex } from "../src/core/proof/witness.js";
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
  const nullifier = noteNullifier(owner.spendingKey, commitment, pathIndex(proof.pathIndices));
  expect(ownerAddress(owner.spendingKey)).toBe(owner.ownerPub);
  const out1: TransferOutput = {
    value: 40n,
    blinding: randomNonZeroField(),
    rho: deriveOutputRho(nullifier, 1n),
    ownerPub: recipient.ownerPub,
    assetId: ASSET_BASE,
  };
  const out2: TransferOutput = {
    value: 30n,
    blinding: randomNonZeroField(),
    rho: deriveOutputRho(nullifier, 2n),
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
      withdrawAmount: 20n,
      relayerFee: 10n,
      ext: {
        recipientLo: 1n,
        recipientHi: 2n,
        relayerLo: 3n,
        relayerHi: 4n,
        poolLo: 5n,
        poolHi: 6n,
        chainDomain: 46630n,
      },
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

  it("rejects an output rho the spender chose instead of the derived one", async () => {
    const { input } = sample();
    const attacked = buildTransferWitness({
      ...input,
      out1: { ...input.out1, rho: input.out1.rho },
    });
    attacked.witness.rhoOut1 = (BigInt(attacked.witness.rhoOut1 as string) + 1n).toString();
    await expect(prover.proveCircuit(attacked.witness)).rejects.toBeInstanceOf(ProofError);
    expect(() =>
      buildTransferWitness({
        ...input,
        out1: { ...input.out1, rho: input.out1.rho + 1n },
      }),
    ).toThrow(/derived from the input nullifier/);
  });
});
