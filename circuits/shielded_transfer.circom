pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// Devnet parameters. These must match src/core/constants.ts:
//   TREE_DEPTH = 20
//   VALUE_BITS = 64
//   DOMAIN.commitment = 1, DOMAIN.nullifier = 2, DOMAIN.owner = 3
//   DOMAIN.ext = 5, DOMAIN.rho = 6, DOMAIN.asset = 7, DOMAIN.chain = 9
// A production deployment needs a multi-party ceremony. This file is the
// single-party development circuit.

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
template AssetTag() {
    signal input assetId;
    signal input chainHome;
    signal output out;
    component asset = Poseidon(2);
    asset.inputs[0] <== 7;
    asset.inputs[1] <== assetId;
    component chain = Poseidon(2);
    chain.inputs[0] <== 9;
    chain.inputs[1] <== chainHome;
    component packed = Poseidon(2);
    packed.inputs[0] <== asset.out;
    packed.inputs[1] <== chain.out;
    out <== packed.out;
}

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
    // Amount paid to the recipient. Distinct from the relayer fee.
    signal input withdrawAmount;
    signal input relayerFee;
    // Poseidon over the recipient, the relayer, and a domain binder.
    // The binder is Poseidon(extDomain, poolLo, poolHi, chainDomain, withdrawAmount, relayerFee).
    signal input extDataHash;

    // Private input note.
    signal input valueIn;
    signal input blindingIn;
    signal input rhoIn;
    signal input assetIn;
    signal input chainHome;
    signal input spendingKey;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Private external data. The contract recomputes extDataHash from the
    // recipient it pays, the relayer, the pool address, both amounts, and chain id.
    signal input recipientLo;
    signal input recipientHi;
    signal input relayerLo;
    signal input relayerHi;
    signal input poolLo;
    signal input poolHi;
    signal input chainDomain;

    // Private outputs. out2 is the change note (it may be a hidden zero).
    // rhoOut is not free: it is Poseidon(rhoDomain, input nullifier, output index).
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
    component rangeWithdraw = AssertRange(valueBits);
    rangeWithdraw.value <== withdrawAmount;
    component rangeFee = AssertRange(valueBits);
    rangeFee.value <== relayerFee;

    // Safe because every term is range-checked into 64 bits.
    valueIn === valueOut1 + valueOut2 + withdrawAmount + relayerFee;
    assetIn === assetOut1;
    assetIn === assetOut2;

    component owner = Poseidon(2);
    owner.inputs[0] <== 3;
    owner.inputs[1] <== spendingKey;

    component tagIn = AssetTag();
    tagIn.assetId <== assetIn;
    tagIn.chainHome <== chainHome;
    component commitIn = Poseidon(6);
    commitIn.inputs[0] <== 1;
    commitIn.inputs[1] <== valueIn;
    commitIn.inputs[2] <== blindingIn;
    commitIn.inputs[3] <== rhoIn;
    commitIn.inputs[4] <== owner.out;
    commitIn.inputs[5] <== tagIn.out;

    component membership = MerklePath(depth);
    membership.leaf <== commitIn.out;
    for (var i = 0; i < depth; i++) {
        membership.pathElements[i] <== pathElements[i];
        membership.pathIndices[i] <== pathIndices[i];
    }
    membership.root === merkleRoot;

    // Leaf index is the integer encoded by the path bits, so a duplicate rho
    // at two positions cannot share a nullifier.
    signal indexAcc[depth + 1];
    indexAcc[0] <== 0;
    var indexPow = 1;
    for (var i = 0; i < depth; i++) {
        indexAcc[i + 1] <== indexAcc[i] + pathIndices[i] * indexPow;
        indexPow = indexPow + indexPow;
    }

    component nullifier = Poseidon(4);
    nullifier.inputs[0] <== 2;
    nullifier.inputs[1] <== spendingKey;
    nullifier.inputs[2] <== commitIn.out;
    nullifier.inputs[3] <== indexAcc[depth];
    nullifier.out === nullifierHash;

    component rho1 = Poseidon(3);
    rho1.inputs[0] <== 6;
    rho1.inputs[1] <== nullifier.out;
    rho1.inputs[2] <== 1;
    rho1.out === rhoOut1;

    component rho2 = Poseidon(3);
    rho2.inputs[0] <== 6;
    rho2.inputs[1] <== nullifier.out;
    rho2.inputs[2] <== 2;
    rho2.out === rhoOut2;

    component tagOut1 = AssetTag();
    tagOut1.assetId <== assetOut1;
    tagOut1.chainHome <== chainHome;
    component commitOut1 = Poseidon(6);
    commitOut1.inputs[0] <== 1;
    commitOut1.inputs[1] <== valueOut1;
    commitOut1.inputs[2] <== blindingOut1;
    commitOut1.inputs[3] <== rhoOut1;
    commitOut1.inputs[4] <== ownerOut1;
    commitOut1.inputs[5] <== tagOut1.out;
    commitOut1.out === commitmentOut1;

    component tagOut2 = AssetTag();
    tagOut2.assetId <== assetOut2;
    tagOut2.chainHome <== chainHome;
    component commitOut2 = Poseidon(6);
    commitOut2.inputs[0] <== 1;
    commitOut2.inputs[1] <== valueOut2;
    commitOut2.inputs[2] <== blindingOut2;
    commitOut2.inputs[3] <== rhoOut2;
    commitOut2.inputs[4] <== ownerOut2;
    commitOut2.inputs[5] <== tagOut2.out;
    commitOut2.out === commitmentOut2;

    component binder = Poseidon(6);
    binder.inputs[0] <== 5;
    binder.inputs[1] <== poolLo;
    binder.inputs[2] <== poolHi;
    binder.inputs[3] <== chainDomain;
    binder.inputs[4] <== withdrawAmount;
    binder.inputs[5] <== relayerFee;

    component extData = Poseidon(6);
    extData.inputs[0] <== recipientLo;
    extData.inputs[1] <== recipientHi;
    extData.inputs[2] <== relayerLo;
    extData.inputs[3] <== relayerHi;
    extData.inputs[4] <== binder.out;
    extData.inputs[5] <== 0;
    extData.out === extDataHash;
}

component main {public [merkleRoot, nullifierHash, commitmentOut1, commitmentOut2, withdrawAmount, relayerFee, extDataHash]} = ShieldedTransfer(20, 64);
