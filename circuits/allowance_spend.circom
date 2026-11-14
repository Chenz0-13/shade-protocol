pragma circom 2.0.0;

include "lib/common.circom";

// Agent allowance spend. The note commitment binds a spend cap and an expiry.
// A payment is accepted only when amount <= cap, amount <= value, and now <= expiry.
// Public inputs: merkleRoot, nullifierHash, amount, now, expiry.
// This circuit is not part of the default Groth16 setup. Tests check constraints
// with the witness calculator.

template AllowanceSpend(depth, valueBits) {
    signal input merkleRoot;
    signal input nullifierHash;
    signal input amount;
    signal input now;
    signal input expiry;

    signal input value;
    signal input cap;
    signal input blinding;
    signal input rho;
    signal input assetId;
    signal input chainHome;
    signal input spendingKey;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    component rangeValue = AssertRange(valueBits);
    rangeValue.value <== value;
    component rangeCap = AssertRange(valueBits);
    rangeCap.value <== cap;
    component rangeAmount = AssertRange(valueBits);
    rangeAmount.value <== amount;
    component rangeNow = AssertRange(valueBits);
    rangeNow.value <== now;
    component rangeExpiry = AssertRange(valueBits);
    rangeExpiry.value <== expiry;

    // Underflow makes the difference larger than 64 bits, so the range check fails.
    component withinCap = AssertRange(valueBits);
    withinCap.value <== cap - amount;
    component withinValue = AssertRange(valueBits);
    withinValue.value <== value - amount;
    component beforeExpiry = AssertRange(valueBits);
    beforeExpiry.value <== expiry - now;

    component owner = Poseidon(2);
    owner.inputs[0] <== 3;
    owner.inputs[1] <== spendingKey;

    component tag = AssetTag();
    tag.assetId <== assetId;
    tag.chainHome <== chainHome;
    component policy = Poseidon(3);
    policy.inputs[0] <== 10;
    policy.inputs[1] <== cap;
    policy.inputs[2] <== expiry;
    component packed = Poseidon(2);
    packed.inputs[0] <== tag.out;
    packed.inputs[1] <== policy.out;

    component commit = Poseidon(6);
    commit.inputs[0] <== 1;
    commit.inputs[1] <== value;
    commit.inputs[2] <== blinding;
    commit.inputs[3] <== rho;
    commit.inputs[4] <== owner.out;
    commit.inputs[5] <== packed.out;

    component membership = MerklePath(depth);
    membership.leaf <== commit.out;
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
    nullifier.inputs[2] <== commit.out;
    nullifier.inputs[3] <== index.out;
    nullifier.out === nullifierHash;
}

component main {public [merkleRoot, nullifierHash, amount, now, expiry]} = AllowanceSpend(20, 64);
