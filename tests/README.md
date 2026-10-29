# Tests

`npm test` runs the Vitest suite in this directory. Proof tests need
`npm run circuit:setup` first. The suite covers forged Merkle paths, invalid
proofs, double spends, buy/buy mismatches, one order matching only one
counterparty, and settlement output notes.
