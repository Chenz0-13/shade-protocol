# Circuits

`shielded_transfer.circom` is the devnet shielded transfer. It checks a
depth-20 Poseidon membership proof, the note commitment, a nullifier of
`Poseidon(domain, spending key, commitment, leaf index)`, derived output
rhos, 64-bit ranges, asset equality, and value conservation across two
outputs, a public withdraw amount, and a separate relayer fee. The external
data hash binds the pool address.

`npm run circuit:setup` compiles it with circom and runs a single-party
Groth16 setup. Those keys are for tests and devnet only.
