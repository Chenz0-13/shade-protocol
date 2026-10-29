import { TREE_DEPTH } from "../constants.js";
import { assertValue } from "../crypto/field.js";
import { noteCommitment, noteNullifier, ownerAddress, type NoteParts } from "../crypto/note.js";

export interface TransferOutput {
  value: bigint;
  blinding: bigint;
  rho: bigint;
  ownerPub: bigint;
  assetId: bigint;
}

export interface TransferWitnessInput {
  root: bigint;
  spendingKey: bigint;
  valueIn: bigint;
  blindingIn: bigint;
  rhoIn: bigint;
  assetIn: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  fee: bigint;
  out1: TransferOutput;
  out2: TransferOutput;
}

export function buildTransferWitness(input: TransferWitnessInput): {
  commitmentIn: bigint;
  nullifier: bigint;
  witness: Record<string, string | string[]>;
  publicSignals: string[];
} {
  if (input.pathElements.length !== TREE_DEPTH || input.pathIndices.length !== TREE_DEPTH) {
    throw new Error(`Merkle path must have depth ${TREE_DEPTH}`);
  }
  assertValue("valueIn", input.valueIn);
  assertValue("valueOut1", input.out1.value);
  assertValue("valueOut2", input.out2.value);
  assertValue("fee", input.fee);
  if (input.valueIn !== input.out1.value + input.out2.value + input.fee) {
    throw new Error("input value does not equal outputs plus fee");
  }
  if (input.assetIn !== input.out1.assetId || input.assetIn !== input.out2.assetId) {
    throw new Error("output asset does not match the input asset");
  }

  const commitmentOut1 = noteCommitment(toParts(input.out1));
  const commitmentOut2 = noteCommitment(toParts(input.out2));
  const nullifier = noteNullifier(input.spendingKey, input.rhoIn);
  // Recomputed by the circuit from spendingKey. Checked here so a caller can
  // compare it with the leaf they inserted.
  const commitmentIn = noteCommitment({
    value: input.valueIn,
    blinding: input.blindingIn,
    rho: input.rhoIn,
    ownerPub: ownerAddress(input.spendingKey),
    assetId: input.assetIn,
  });

  const witness: Record<string, string | string[]> = {
    merkleRoot: input.root.toString(),
    nullifierHash: nullifier.toString(),
    commitmentOut1: commitmentOut1.toString(),
    commitmentOut2: commitmentOut2.toString(),
    fee: input.fee.toString(),
    valueIn: input.valueIn.toString(),
    blindingIn: input.blindingIn.toString(),
    rhoIn: input.rhoIn.toString(),
    assetIn: input.assetIn.toString(),
    spendingKey: input.spendingKey.toString(),
    pathElements: input.pathElements.map((item) => item.toString()),
    pathIndices: input.pathIndices.map((item) => item.toString()),
    valueOut1: input.out1.value.toString(),
    blindingOut1: input.out1.blinding.toString(),
    rhoOut1: input.out1.rho.toString(),
    ownerOut1: input.out1.ownerPub.toString(),
    assetOut1: input.out1.assetId.toString(),
    valueOut2: input.out2.value.toString(),
    blindingOut2: input.out2.blinding.toString(),
    rhoOut2: input.out2.rho.toString(),
    ownerOut2: input.out2.ownerPub.toString(),
    assetOut2: input.out2.assetId.toString(),
  };
  return {
    commitmentIn,
    nullifier,
    witness,
    publicSignals: [
      witness.merkleRoot as string,
      witness.nullifierHash as string,
      witness.commitmentOut1 as string,
      witness.commitmentOut2 as string,
      witness.fee as string,
    ],
  };
}

function toParts(output: TransferOutput): NoteParts {
  return {
    value: output.value,
    blinding: output.blinding,
    rho: output.rho,
    ownerPub: output.ownerPub,
    assetId: output.assetId,
  };
}
