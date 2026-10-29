# Security

Shade Protocol is a devnet implementation of a shielded-note and compliance
engine. It is not ready for mainnet, and it has not had an external audit.

## Report a vulnerability

Please use GitHub private vulnerability reporting for this repository. Do not
open a public issue for an unfixed security bug. Include a description, the
affected code path, and a proof of concept if you have one.

## What is not safe to deploy

- The Groth16 keys produced by `npm run circuit:setup` are a **single-party
  development setup**. The toxic waste is not destroyed by a multi-party
  ceremony. Anyone who keeps the intermediate parameters can forge proofs.
  Do not deploy those keys.
- The commitment tree is depth 8 (256 leaves). That is a devnet parameter.
- `DarkPool` decrypts order openings so it can build settlement proofs. A
  hosted operator using that class learns spending keys for escrowed notes.
  Do not put third-party funds behind it.
- `DevnetPermissiveScreen` does not check a sanctions list. Address screening
  is an interface the operator must implement.
- There is no on-chain Shade program. Solana submission anchors public inputs
  in a Memo transaction on devnet or testnet. Mainnet RPC URLs and the
  mainnet genesis hash are rejected.
- NEAR, Canton, and Robinhood submission throw rather than returning a
  transaction id.
- Selective-disclosure KYC as a Groth16 circuit is not implemented.

## Handling secrets

Do not commit `.env`, keypairs, or ceremony entropy. The logger redacts
fields whose names look like secrets, and it does not print raw key bytes.
Log messages themselves must not contain secrets. `SOLANA_KEYPAIR` is read
from the environment and is never written into the example config as a real key.

## Dependencies

`circomlib` and `snarkjs` are GPL-3.0. The original code in this repository
is offered under the MIT license in `LICENSE`; confirm that combination
before distributing a combined work. See the README for the production
checklist.
