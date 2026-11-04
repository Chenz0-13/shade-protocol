import { TREE_DEPTH } from "../constants.js";
import { assertValue } from "../crypto/field.js";
import { deriveOutputRho, noteCommitment, noteNullifier, ownerAddress, type NoteParts } from "../crypto/note.js";
import { extDataHash, type ExtDataLimbs } from "./extData.js";

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
  withdrawAmount: bigint;
  relayerFee: bigint;
  ext: ExtDataLimbs;
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
  assertValue("withdrawAmount", input.withdrawAmount);
  assertValue("relayerFee", input.relayerFee);
  if (input.valueIn !== input.out1.value + input.out2.value + input.withdrawAmount + input.relayerFee) {
    throw new Error("input value does not equal outputs plus withdraw amount plus relayer fee");
  }
  if (input.assetIn !== input.out1.assetId || input.assetIn !== input.out2.assetId) {
    throw new Error("output asset does not match the input asset");
  }

  const commitmentIn = noteCommitment({
    value: input.valueIn,
    blinding: input.blindingIn,
    rho: input.rhoIn,
    ownerPub: ownerAddress(input.spendingKey),
    assetId: input.assetIn,
  });
  const leafIndex = pathIndex(input.pathIndices);
  const nullifier = noteNullifier(input.spendingKey, commitmentIn, leafIndex);
  const rhoOut1 = deriveOutputRho(nullifier, 1n);
  const rhoOut2 = deriveOutputRho(nullifier, 2n);
  if (input.out1.rho !== rhoOut1 || input.out2.rho !== rhoOut2) {
    throw new Error("output rho must be derived from the input nullifier");
  }
  const bound = extDataHash(input.ext, input.withdrawAmount, input.relayerFee);
  const commitmentOut1 = noteCommitment(toParts(input.out1));
  const commitmentOut2 = noteCommitment(toParts(input.out2));

  const witness: Record<string, string | string[]> = {
    merkleRoot: input.root.toString(),
    nullifierHash: nullifier.toString(),
    commitmentOut1: commitmentOut1.toString(),
    commitmentOut2: commitmentOut2.toString(),
    withdrawAmount: input.withdrawAmount.toString(),
    relayerFee: input.relayerFee.toString(),
    extDataHash: bound.toString(),
    recipientLo: input.ext.recipientLo.toString(),
    recipientHi: input.ext.recipientHi.toString(),
    relayerLo: input.ext.relayerLo.toString(),
    relayerHi: input.ext.relayerHi.toString(),
    poolLo: input.ext.poolLo.toString(),
    poolHi: input.ext.poolHi.toString(),
    chainDomain: input.ext.chainDomain.toString(),
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
      witness.withdrawAmount as string,
      witness.relayerFee as string,
      witness.extDataHash as string,
    ],
  };
}

/** Integer leaf index encoded by the Merkle path bits. Matches the circuit. */
export function pathIndex(pathIndices: readonly number[]): bigint {
  let acc = 0n;
  let pow = 1n;
  for (const bit of pathIndices) {
    if (bit !== 0 && bit !== 1) throw new Error("Merkle path index must be 0 or 1");
    acc += BigInt(bit) * pow;
    pow *= 2n;
  }
  return acc;
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
