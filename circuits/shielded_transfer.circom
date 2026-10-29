pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

template NullifierDerive() {
    signal input key;
    signal input note;
    signal output out;

    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== key;
    poseidon.inputs[1] <== note;
    out <== poseidon.out;
}

template MerkleProof(depth) {
    signal input leaf;
    signal input root;
    signal input path[depth];
    signal output valid;

    // Placeholder membership constraint.
    // Real implementation should verify each hash pair against the supplied merkle path.
    valid <== 1;
}

template PedersenCommit() {
    signal input value;
    signal input blinding;
    signal output out;

    // Placeholder commitment.
    out <== value + blinding;
}

template ShieldedTransfer() {
    signal input merkle_root;
    signal input nullifier_hash;
    signal input commitment_out;

    signal input note_value;
    signal input note_blinding;
    signal input spending_key;
    signal input merkle_path[32];

    component nullifierCheck = NullifierDerive();
    nullifierCheck.key <== spending_key;
    nullifierCheck.note <== note_value;
    nullifierCheck.out === nullifier_hash;

    component membership = MerkleProof(32);
    membership.leaf <== note_value + note_blinding;
    membership.root <== merkle_root;
    for (var i = 0; i < 32; i++) {
        membership.path[i] <== merkle_path[i];
    }
    membership.valid === 1;

    component commit = PedersenCommit();
    commit.value <== note_value;
    commit.blinding <== note_blinding;
    commit.out === commitment_out;
}

component main { public [merkle_root, nullifier_hash, commitment_out] } = ShieldedTransfer();
