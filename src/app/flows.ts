import { ASSET_BASE, TREE_DEPTH } from "../core/constants.js";
import { randomNonZeroField } from "../core/crypto/field.js";
import { deriveOutputRho, noteCommitment, noteNullifier, type NoteParts } from "../core/crypto/note.js";
import { MerkleTree } from "../core/merkle/MerkleTree.js";
import { extDataHash, type ExtDataLimbs } from "../core/proof/extData.js";
import { buildTransferWitness, type TransferWitnessInput } from "../core/proof/witness.js";

export interface ShieldPlan {
  blinding: bigint;
  rho: bigint;
  ownerPub: bigint;
  assetId: bigint;
  chainHome: bigint;
  value: bigint;
  commitment: bigint;
}

export interface PlannedOutput {
  value: bigint;
  blinding: bigint;
  rho: bigint;
  ownerPub: bigint;
  assetId: bigint;
  chainHome: bigint;
  commitment: bigint;
}

export interface SpendPlan {
  input: TransferWitnessInput;
  witness: Record<string, string | string[]>;
  publicSignals: string[];
  commitmentIn: bigint;
  nullifier: bigint;
  outputs: [PlannedOutput, PlannedOutput];
  leafIndex: number;
  root: bigint;
  extDataHash: bigint;
}

export function planShield(
  ownerPub: bigint,
  value: bigint,
  chainHome: bigint,
  assetId: bigint = ASSET_BASE,
): ShieldPlan {
  if (value <= 0n) throw new Error("Enter an amount greater than zero.");
  const blinding = randomNonZeroField();
  const rho = randomNonZeroField();
  const commitment = noteCommitment({ value, blinding, rho, ownerPub, assetId, chainHome });
  return { blinding, rho, ownerPub, assetId, chainHome, value, commitment };
}

export function planSpend(params: {
  spendingKey: bigint;
  note: NoteParts & { leafIndex: number | null };
  leaves: readonly bigint[];
  withdrawAmount: bigint;
  relayerFee: bigint;
  out1: { value: bigint; ownerPub: bigint };
  out2: { value: bigint; ownerPub: bigint };
  ext: ExtDataLimbs;
}): SpendPlan {
  if (params.out1.value + params.out2.value + params.withdrawAmount + params.relayerFee !== params.note.value) {
    throw new Error("The amount plus what you keep has to equal the note.");
  }
  const commitmentIn = noteCommitment(params.note);
  const tree = MerkleTree.empty(TREE_DEPTH);
  let found = -1;
  params.leaves.forEach((leaf, index) => {
    tree.insert(leaf);
    if (leaf === commitmentIn) found = index;
  });
  if (found < 0) throw new Error("This note is not in the pool history this browser could read.");
  if (params.note.leafIndex !== null && params.note.leafIndex !== found) {
    throw new Error("This note's position in the pool does not match the saved note.");
  }
  const proof = tree.getProof(found);
  const nullifier = noteNullifier(params.spendingKey, commitmentIn, BigInt(found));
  const outputs: [PlannedOutput, PlannedOutput] = [
    fillOutput(params.out1.value, params.out1.ownerPub, params.note.assetId, params.note.chainHome, deriveOutputRho(nullifier, 1n)),
    fillOutput(params.out2.value, params.out2.ownerPub, params.note.assetId, params.note.chainHome, deriveOutputRho(nullifier, 2n)),
  ];
  const input: TransferWitnessInput = {
    root: proof.root,
    spendingKey: params.spendingKey,
    valueIn: params.note.value,
    blindingIn: params.note.blinding,
    rhoIn: params.note.rho,
    assetIn: params.note.assetId,
    chainHome: params.note.chainHome,
    pathElements: proof.pathElements,
    pathIndices: proof.pathIndices,
    withdrawAmount: params.withdrawAmount,
    relayerFee: params.relayerFee,
    ext: params.ext,
    out1: outputs[0],
    out2: outputs[1],
  };
  const built = buildTransferWitness(input);
  return {
    input,
    witness: built.witness,
    publicSignals: built.publicSignals,
    commitmentIn,
    nullifier,
    outputs,
    leafIndex: found,
    root: proof.root,
    extDataHash: extDataHash(params.ext, params.withdrawAmount, params.relayerFee),
  };
}

function fillOutput(
  value: bigint,
  ownerPub: bigint,
  assetId: bigint,
  chainHome: bigint,
  rho: bigint,
): PlannedOutput {
  const blinding = randomNonZeroField();
  return {
    value,
    blinding,
    rho,
    ownerPub,
    assetId,
    chainHome,
    commitment: noteCommitment({ value, blinding, rho, ownerPub, assetId, chainHome }),
  };
}
