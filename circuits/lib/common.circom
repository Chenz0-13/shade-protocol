pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

template MerklePath(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    signal level[depth + 1];
    level[0] <== leaf;
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== level[i] + pathIndices[i] * (pathElements[i] - level[i]);
        hashers[i].inputs[1] <== pathElements[i] + pathIndices[i] * (level[i] - pathElements[i]);
        level[i + 1] <== hashers[i].out;
    }
    root <== level[depth];
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

template LeafIndex(depth) {
    signal input pathIndices[depth];
    signal output out;
    signal acc[depth + 1];
    acc[0] <== 0;
    var pow = 1;
    for (var i = 0; i < depth; i++) {
        acc[i + 1] <== acc[i] + pathIndices[i] * pow;
        pow = pow + pow;
    }
    out <== acc[depth];
}
