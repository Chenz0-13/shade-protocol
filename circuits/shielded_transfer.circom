pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// Devnet parameters. These must match src/core/constants.ts:
//   TREE_DEPTH = 8
//   VALUE_BITS = 64
//   DOMAIN.commitment = 1, DOMAIN.nullifier = 2, DOMAIN.owner = 3
// A production deployment needs a larger depth and a real multi-party ceremony.

template MerklePath(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    signal level[depth + 1];
    level[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // Boolean selector: 0 means the current node is the left child.
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== level[i] + pathIndices[i] * (pathElements[i] - level[i]);
        hashers[i].inputs[1] <== pathElements[i] + pathIndices[i] * (level[i] - pathElements[i]);
        level[i + 1] <== hashers[i].out;
    }

    root <== level[depth];
}

// Keeps Num2Bits outputs live so the range constraint cannot be optimized away.
template AssertRange(bits) {
    signal input value;
    component bitsOf = Num2Bits(bits);
    bitsOf.in <== value;

    signal acc[bits + 1];
    acc[0] <== 0;
    var pow = 1;
    for (var i = 0; i < bits; i++) {
        acc[i + 1] <== acc[i] + bitsOf.out[i] * pow;
        pow = pow + pow;
    }
    acc[bits] === value;
}

template ShieldedTransfer(depth, valueBits) {
    // Public inputs.
    signal input merkleRoot;
    signal input nullifierHash;
    signal input commitmentOut1;
    signal input commitmentOut2;
    signal input fee;

    // Private input note.
    signal input valueIn;
    signal input blindingIn;
    signal input rhoIn;
    signal input assetIn;
    signal input spendingKey;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Private outputs. out2 is the change note (it may be a hidden zero).
    signal input valueOut1;
    signal input blindingOut1;
    signal input rhoOut1;
    signal input ownerOut1;
    signal input assetOut1;

    signal input valueOut2;
    signal input blindingOut2;
    signal input rhoOut2;
    signal input ownerOut2;
    signal input assetOut2;

    component rangeIn = AssertRange(valueBits);
    rangeIn.value <== valueIn;
    component rangeOut1 = AssertRange(valueBits);
    rangeOut1.value <== valueOut1;
    component rangeOut2 = AssertRange(valueBits);
    rangeOut2.value <== valueOut2;
    component rangeFee = AssertRange(valueBits);
    rangeFee.value <== fee;

    // Safe because every term is range-checked into 64 bits.
    valueIn === valueOut1 + valueOut2 + fee;
    assetIn === assetOut1;
    assetIn === assetOut2;

    component owner = Poseidon(2);
    owner.inputs[0] <== 3;
    owner.inputs[1] <== spendingKey;

    component commitIn = Poseidon(6);
    commitIn.inputs[0] <== 1;
    commitIn.inputs[1] <== valueIn;
    commitIn.inputs[2] <== blindingIn;
    commitIn.inputs[3] <== rhoIn;
    commitIn.inputs[4] <== owner.out;
    commitIn.inputs[5] <== assetIn;

    component membership = MerklePath(depth);
    membership.leaf <== commitIn.out;
    for (var i = 0; i < depth; i++) {
        membership.pathElements[i] <== pathElements[i];
        membership.pathIndices[i] <== pathIndices[i];
    }
    membership.root === merkleRoot;

    component nullifier = Poseidon(3);
    nullifier.inputs[0] <== 2;
    nullifier.inputs[1] <== spendingKey;
    nullifier.inputs[2] <== rhoIn;
    nullifier.out === nullifierHash;

    component commitOut1 = Poseidon(6);
    commitOut1.inputs[0] <== 1;
    commitOut1.inputs[1] <== valueOut1;
    commitOut1.inputs[2] <== blindingOut1;
    commitOut1.inputs[3] <== rhoOut1;
    commitOut1.inputs[4] <== ownerOut1;
    commitOut1.inputs[5] <== assetOut1;
    commitOut1.out === commitmentOut1;

    component commitOut2 = Poseidon(6);
    commitOut2.inputs[0] <== 1;
    commitOut2.inputs[1] <== valueOut2;
    commitOut2.inputs[2] <== blindingOut2;
    commitOut2.inputs[3] <== rhoOut2;
    commitOut2.inputs[4] <== ownerOut2;
    commitOut2.inputs[5] <== assetOut2;
    commitOut2.out === commitmentOut2;
}

component main {public [merkleRoot, nullifierHash, commitmentOut1, commitmentOut2, fee]} = ShieldedTransfer(8, 64);
