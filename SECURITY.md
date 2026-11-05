# Security

Shader Protocol in this repository is a devnet and testnet implementation of a
shielded-note engine. It is not ready for mainnet. It has not had an external
audit. Nothing here is a claim of compliance, production safety, or a
completed trusted setup.

## Report a vulnerability

Please use GitHub private vulnerability reporting for this repository. Do not
open a public issue for an unfixed security bug. Include a description, the
affected code path, and a proof of concept if you have one.

## What is not safe to deploy

- The Groth16 keys produced by `npm run circuit:setup` are a single-party
  development setup. The toxic waste is not destroyed by a multi-party
  ceremony. Anyone who keeps the intermediate parameters can forge proofs.
  Do not deploy those keys.
- The commitment tree is depth 20. That is larger than the earlier devnet
  tree, and it is still a devnet parameter. The on-chain trees are incremental
  frontiers (one filled node per level), not a stored copy of every leaf.
- `DarkPool` decrypts order openings so it can build settlement proofs. A
  hosted operator using that class learns the spending keys for escrowed
  notes. Do not put third-party funds behind it.
- `DevnetPermissiveScreen` does not check a sanctions list. Address screening
  is an interface the operator must implement. There is no Groth16 selective
  disclosure KYC circuit.
- Deploy scripts and adapters refuse mainnet by chain id or genesis hash.
  Robinhood mainnet is chain id 4663. Solana mainnet is genesis
  `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. NEAR mainnet is chain id
  `mainnet` from the RPC `status` method. A URL that happens to contain the
  word mainnet is not the control, and a URL that omits that word is not
  permission to deploy.
- Each chain has a minimum deposit chosen at pool initialization. A deposit
  below that minimum is rejected. The parameter is a devnet knob, not a
  compliance control.

## Trust assumptions by chain

- Robinhood Chain testnet (46630) and Kinetiq Elysium testnet (99801) verify
  the Groth16 proof in `ShadePool`. The pool pays `withdrawAmount` to the
  recipient and `relayerFee` to the relayer. Both amounts, the recipient, the
  relayer, the pool address, and `block.chainid` are bound into `extDataHash`.
  A proof built for one pool does not authorize a payout from another. The
  verifier key is the single-party development setup.
- Solana devnet and testnet run the same public-input layout in
  `programs/shade-solana`. Nullifier accounts are program-derived addresses.
  Creation uses allocate, assign, and transfer so a prefunded system account
  cannot freeze a note. The program still trusts the single-party verifying
  key. Compute is bounded by a depth-20 frontier (one Poseidon hash per level
  per inserted leaf) plus one Groth16 verification.
- NEAR testnet verifies the same proof and then pays with a promise. If the
  transfer fails, the nullifier stays spent, because the output notes were
  already inserted, and the contract records a refundable claim. A caller can
  `claim_refund` later. The contract account is the pool address mixed into
  `extDataHash`. The verification key is fixed in `#[init]`.
- Canton is not a verifier. Daml has no BN254 pairing. `AttestorSet.threshold`
  is 2 because `Record` requires exactly two controllers. Two named attestors
  must both authorize a record. One attestor, the publisher alone, and an
  outsider cannot. If two attestors sign a result that never happened on the
  EVM pool, Canton records it. That is a 2-of-N attestation over the named
  set, not a proof check. See `docs/canton-attestation.md`.

## Nullifiers

The nullifier is `Poseidon(domain, spending key, commitment, leaf index)`.
Two notes that reuse rho no longer share a nullifier, so spending one does
not freeze the other. Output rhos are `Poseidon(rho domain, input nullifier,
output index)`. A spender cannot choose them. Deposit rho is still chosen by
the depositor and is hidden by the commitment.

## Handling secrets

Do not commit `.env`, keypairs, or ceremony entropy. The logger redacts
fields whose names look like secrets, and it does not print raw key bytes.
Log messages themselves must not contain secrets. Deploy keys are read from
the environment and are not written into the repository.

## Tooling

`docs/security-tooling.md` lists the scanners that run in CI, the versions
they are pinned to, and every finding that is still open. The tooling is not
an audit.

## Dependencies

`circomlib` and `snarkjs` are GPL-3.0. The original code in this repository
is offered under the MIT license in `LICENSE`. Confirm that combination
before distributing a combined work.
