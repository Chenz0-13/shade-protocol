pragma circom 2.0.0;

include "lib/common.circom";
include "circomlib/circuits/comparators.circom";

// Burn one note on its home chain. commitmentOut is the note the destination
// pool may mint. Its chainHome is destChain, not the source chain.
// Public inputs match the withdraw width so a thin verifier can share the
// 7-slot layout: root, nullifier, commitmentOut, destChain, amount, relayerFee, extDataHash.
// Proving keys are not part of the default dev setup.

template TeleportOut(depth, valueBits) {
    signal input merkleRoot;
    signal input nullifierHash;
    signal input commitmentOut;
    signal input destChain;
    signal input amount;
    signal input relayerFee;
    signal input extDataHash;

    signal input valueIn;
    signal input blindingIn;
    signal input rhoIn;
    signal input assetId;
    signal input chainHome;
    signal input spendingKey;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input blindingOut;
    signal input ownerOut;

    signal input recipientLo;
    signal input recipientHi;
    signal input relayerLo;
    signal input relayerHi;
    signal input poolLo;
    signal input poolHi;

    component rangeIn = AssertRange(valueBits);
    rangeIn.value <== valueIn;
    component rangeAmount = AssertRange(valueBits);
    rangeAmount.value <== amount;
    component rangeFee = AssertRange(valueBits);
    rangeFee.value <== relayerFee;
    valueIn === amount + relayerFee;
    component destBits = AssertRange(64);
    destBits.value <== destChain;
    component destZero = IsZero();
    destZero.in <== destChain;
    destZero.out === 0;
    component sameChain = IsZero();
    sameChain.in <== destChain - chainHome;
    sameChain.out === 0;

    component owner = Poseidon(2);
    owner.inputs[0] <== 3;
    owner.inputs[1] <== spendingKey;
    component tagIn = AssetTag();
    tagIn.assetId <== assetId;
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

    component index = LeafIndex(depth);
    for (var i = 0; i < depth; i++) {
        index.pathIndices[i] <== pathIndices[i];
    }
    component nullifier = Poseidon(4);
    nullifier.inputs[0] <== 2;
    nullifier.inputs[1] <== spendingKey;
    nullifier.inputs[2] <== commitIn.out;
    nullifier.inputs[3] <== index.out;
    nullifier.out === nullifierHash;

    component rhoOut = Poseidon(3);
    rhoOut.inputs[0] <== 6;
    rhoOut.inputs[1] <== nullifier.out;
    rhoOut.inputs[2] <== 1;
    component tagOut = AssetTag();
    tagOut.assetId <== assetId;
    tagOut.chainHome <== destChain;
    component commitOut = Poseidon(6);
    commitOut.inputs[0] <== 1;
    commitOut.inputs[1] <== amount;
    commitOut.inputs[2] <== blindingOut;
    commitOut.inputs[3] <== rhoOut.out;
    commitOut.inputs[4] <== ownerOut;
    commitOut.inputs[5] <== tagOut.out;
    commitOut.out === commitmentOut;

    component binder = Poseidon(6);
    binder.inputs[0] <== 5;
    binder.inputs[1] <== poolLo;
    binder.inputs[2] <== poolHi;
    binder.inputs[3] <== chainHome;
    binder.inputs[4] <== amount;
    binder.inputs[5] <== relayerFee;
    component extData = Poseidon(6);
    extData.inputs[0] <== recipientLo;
    extData.inputs[1] <== recipientHi;
    extData.inputs[2] <== relayerLo;
    extData.inputs[3] <== relayerHi;
    extData.inputs[4] <== binder.out;
    extData.inputs[5] <== destChain;
    extData.out === extDataHash;
}

component main {public [merkleRoot, nullifierHash, commitmentOut, destChain, amount, relayerFee, extDataHash]} = TeleportOut(20, 64);
