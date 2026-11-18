pragma circom 2.0.0;

include "lib/common.circom";
include "circomlib/circuits/comparators.circom";

// 2-in / 2-out transfer. Same asset and chainHome on every note.
// Public inputs: merkleRoot, nullifier0, nullifier1, commitmentOut0, commitmentOut1, extDataHash.
// Proving keys are not part of the default dev setup. See docs/note-format-v2.md.

template Transfer2x2(depth, valueBits) {
    signal input merkleRoot;
    signal input nullifier0;
    signal input nullifier1;
    signal input commitmentOut0;
    signal input commitmentOut1;
    signal input extDataHash;

    signal input valueIn0;
    signal input blindingIn0;
    signal input rhoIn0;
    signal input valueIn1;
    signal input blindingIn1;
    signal input rhoIn1;
    signal input assetId;
    signal input chainHome;
    signal input spendingKey0;
    signal input spendingKey1;
    signal input pathElements0[depth];
    signal input pathIndices0[depth];
    signal input pathElements1[depth];
    signal input pathIndices1[depth];

    signal input valueOut0;
    signal input blindingOut0;
    signal input ownerOut0;
    signal input valueOut1;
    signal input blindingOut1;
    signal input ownerOut1;

    signal input recipientLo;
    signal input recipientHi;
    signal input relayerLo;
    signal input relayerHi;
    signal input poolLo;
    signal input poolHi;
    signal input chainDomain;

    component range0 = AssertRange(valueBits);
    range0.value <== valueIn0;
    component range1 = AssertRange(valueBits);
    range1.value <== valueIn1;
    component rangeOut0 = AssertRange(valueBits);
    rangeOut0.value <== valueOut0;
    component rangeOut1 = AssertRange(valueBits);
    rangeOut1.value <== valueOut1;
    valueIn0 + valueIn1 === valueOut0 + valueOut1;

    component owner0 = Poseidon(2);
    owner0.inputs[0] <== 3;
    owner0.inputs[1] <== spendingKey0;
    component owner1 = Poseidon(2);
    owner1.inputs[0] <== 3;
    owner1.inputs[1] <== spendingKey1;

    component tag = AssetTag();
    tag.assetId <== assetId;
    tag.chainHome <== chainHome;

    component in0 = Poseidon(6);
    in0.inputs[0] <== 1;
    in0.inputs[1] <== valueIn0;
    in0.inputs[2] <== blindingIn0;
    in0.inputs[3] <== rhoIn0;
    in0.inputs[4] <== owner0.out;
    in0.inputs[5] <== tag.out;
    component in1 = Poseidon(6);
    in1.inputs[0] <== 1;
    in1.inputs[1] <== valueIn1;
    in1.inputs[2] <== blindingIn1;
    in1.inputs[3] <== rhoIn1;
    in1.inputs[4] <== owner1.out;
    in1.inputs[5] <== tag.out;

    component member0 = MerklePath(depth);
    member0.leaf <== in0.out;
    component member1 = MerklePath(depth);
    member1.leaf <== in1.out;
    for (var i = 0; i < depth; i++) {
        member0.pathElements[i] <== pathElements0[i];
        member0.pathIndices[i] <== pathIndices0[i];
        member1.pathElements[i] <== pathElements1[i];
        member1.pathIndices[i] <== pathIndices1[i];
    }
    member0.root === merkleRoot;
    member1.root === merkleRoot;

    component index0 = LeafIndex(depth);
    component index1 = LeafIndex(depth);
    for (var i = 0; i < depth; i++) {
        index0.pathIndices[i] <== pathIndices0[i];
        index1.pathIndices[i] <== pathIndices1[i];
    }
    component n0 = Poseidon(4);
    n0.inputs[0] <== 2;
    n0.inputs[1] <== spendingKey0;
    n0.inputs[2] <== in0.out;
    n0.inputs[3] <== index0.out;
    n0.out === nullifier0;
    component n1 = Poseidon(4);
    n1.inputs[0] <== 2;
    n1.inputs[1] <== spendingKey1;
    n1.inputs[2] <== in1.out;
    n1.inputs[3] <== index1.out;
    n1.out === nullifier1;
    // Distinct leaves. Spending the same position twice is not two inputs.
    component sameLeaf = IsZero();
    sameLeaf.in <== index0.out - index1.out;
    sameLeaf.out === 0;

    component rho0 = Poseidon(3);
    rho0.inputs[0] <== 6;
    rho0.inputs[1] <== nullifier0;
    rho0.inputs[2] <== 1;
    component rho1 = Poseidon(3);
    rho1.inputs[0] <== 6;
    rho1.inputs[1] <== nullifier1;
    rho1.inputs[2] <== 1;

    component out0 = Poseidon(6);
    out0.inputs[0] <== 1;
    out0.inputs[1] <== valueOut0;
    out0.inputs[2] <== blindingOut0;
    out0.inputs[3] <== rho0.out;
    out0.inputs[4] <== ownerOut0;
    out0.inputs[5] <== tag.out;
    out0.out === commitmentOut0;
    component out1 = Poseidon(6);
    out1.inputs[0] <== 1;
    out1.inputs[1] <== valueOut1;
    out1.inputs[2] <== blindingOut1;
    out1.inputs[3] <== rho1.out;
    out1.inputs[4] <== ownerOut1;
    out1.inputs[5] <== tag.out;
    out1.out === commitmentOut1;

    component binder = Poseidon(6);
    binder.inputs[0] <== 5;
    binder.inputs[1] <== poolLo;
    binder.inputs[2] <== poolHi;
    binder.inputs[3] <== chainDomain;
    binder.inputs[4] <== 0;
    binder.inputs[5] <== 0;
    component extData = Poseidon(6);
    extData.inputs[0] <== recipientLo;
    extData.inputs[1] <== recipientHi;
    extData.inputs[2] <== relayerLo;
    extData.inputs[3] <== relayerHi;
    extData.inputs[4] <== binder.out;
    extData.inputs[5] <== 0;
    extData.out === extDataHash;
}

component main {public [merkleRoot, nullifier0, nullifier1, commitmentOut0, commitmentOut1, extDataHash]} = Transfer2x2(20, 64);
