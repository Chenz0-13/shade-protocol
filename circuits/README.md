# Circuits

`shielded_transfer.circom` is the devnet shielded transfer. It checks a
depth-8 Poseidon membership proof, the note commitment, the nullifier,
64-bit ranges, asset equality, and value conservation across two outputs
and a public fee.

`npm run circuit:setup` compiles it with circom and runs a single-party
Groth16 setup. Those keys are for tests and devnet only.
