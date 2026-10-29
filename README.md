# Shade Protocol

TypeScript SDK and Circom circuit for a devnet shielded-note pool: Poseidon
commitments, nullifiers, ECDH stealth addresses, Groth16 transfers, an
operator dark pool, and a signed compliance layer.

This repository does not contain Rust crates. The protocol code lives in
`src/`.

## Layout

```text
src/core/crypto       commitments, nullifiers, ECDH stealth, AES-GCM, regulator keys
src/core/merkle       fixed-depth Poseidon tree
src/core/proof        Groth16 witness builder, prove, verify
src/core/pool         operator dark pool
src/core/compliance   credential store, issuer signatures, sanctions hook
src/core/chain        Solana devnet adapter; NEAR, Canton, and Robinhood throw
src/sdk               ShadeClient
circuits/             shielded transfer circuit
tests/                unit and adversarial tests
```

## Cryptography

Notes are hash commitments:

```text
ownerPub   = Poseidon(3, spendingKey)
commitment = Poseidon(1, value, blinding, rho, ownerPub, assetId)
nullifier  = Poseidon(2, spendingKey, rho)
```

`rho` is a fresh field element, so a spending key has a distinct nullifier
for every note. The blinding factor hides the value. The Merkle tree is a
depth-8 Poseidon tree, the same depth the circuit checks. A forged sibling
does not verify.

Incoming notes are encrypted with AES-256-GCM. The key is
`HKDF-SHA256(ECDH shared secret)`, not the raw spending key. The published
address is a dual-key stealth point `spendPub + H(ECDH(ephemeral, viewPub))·G`.
The view key recognizes that point and decrypts the payload. It cannot derive
the ZK spending key. The one-time curve scalar also requires the curve spend
key; that curve key is separate from the ZK spending key because Poseidon is
not homomorphic.

A regulator capability is an issuer-signed secp256k1 encryption key plus a
scope. Notes sealed to it use a scope-bound AES-GCM associated data. A
capability that cannot see amounts is given a redacted plaintext. An expired
or re-scoped capability fails verification or authentication.

The circuit enforces Merkle membership, the commitment and nullifier
derivations above, 64-bit range checks, asset equality, and
`valueIn = valueOut1 + valueOut2 + fee`.

## Dark pool

`DarkPool` is an operator matcher. Orders are sealed to the operator view
key. The operator opens them, checks the escrow note, and produces two
shielded-transfer proofs (payment plus change for each side). Buys match
only sells, price ranges must overlap, and each order is used once.
Nullifiers are marked spent only after both proofs verify. Settlement
inserts the output notes.

The operator learns escrow spending keys. Do not use this class as custody
for anyone else's funds. A production pool would have users build the proofs
locally.

Execution price is the low end of the overlapping range. A sell escrows its
base amount. A buy escrows `amount * maxPrice` of the quote asset.

## Compliance

Credentials are stored behind a `CredentialStore` and hashed with Poseidon
over every field. The issuer signs that hash with Ed25519. Verification
loads the stored credential, checks the signature, and applies policy to the
stored record. A presenter who claims a higher KYC level than the store is
rejected. `SanctionsScreen` is called with the wallet address before success.
`DevnetPermissiveScreen` does not screen anyone.

`generateGroth16KycProof()` throws `NotImplementedError`. There is no fake
Groth16 KYC proof.

## Chains

Every adapter defaults to a devnet or testnet and rejects mainnet. Nothing
here has been broadcast to a live network: this environment has no funded
deploy key. The deploy scripts refuse mainnet and read keys from the
environment.

| Chain | What is implemented | How it was tested | Live deploy |
| --- | --- | --- | --- |
| Robinhood Chain testnet (chain id 46630, Arbitrum Orbit) | `contracts/evm` ShadePool: Poseidon frontier tree, nullifier map, snarkjs Groth16 verifier, ETH deposit and fee withdraw. TS adapter in `src/core/chain/robinhood.ts` (viem). | `forge test` deposits, proves, withdraws, and rejects a second spend. | Not deployed. `node scripts/deploy-robinhood.mjs` needs `ROBINHOOD_PRIVATE_KEY` with testnet ETH. |
| NEAR testnet | `contracts/near` (near-sdk 5.11): same frontier tree, nullifier set, root history, and arkworks Groth16 verification of a snarkjs proof. Note values are yoctoNEAR and must fit in 64 bits. TS adapter signs a real ed25519 function-call transaction with `@noble/curves` (the `@near-js/*` packages pull in `elliptic`, so they were not added). | `cargo test` in `contracts/shade-crypto` verifies a proof from the devnet circuit. `cargo build --target wasm32-unknown-unknown` produces a 2.1 MB wasm. | Not deployed. There is no funded testnet account in this environment. |
| Solana devnet | `programs/shade-solana` verifies the transfer with `groth16-solana` (alt_bn128 syscalls). The TS adapter signs a transaction to that program id. The on-chain Merkle update, nullifier account, and SOL vault are not in this binary yet. | `cargo-build-sbf --features insecure-test-setup` after `npm run circuit:setup`. The verifying key is the single-party setup; the generated file is marked insecure and must not be treated as a production verifier. | Not deployed. `solana program deploy` needs a devnet keypair with SOL. |
| Canton | Not implemented. | The adapter throws `NotImplementedError`. | No. DevNet needs a Super Validator sponsor and an IP allowlist. Daml has no BN254 pairing, so a sandbox contract cannot check this proof. Recording an unchecked proof would be a fake verifier. |

`ROBINHOOD_API_KEY` is gone. Robinhood configuration is `ROBINHOOD_RPC_URL` (default `https://rpc.testnet.chain.robinhood.com`) and `ROBINHOOD_CHAIN_ID` (default `46630`). Chain id `4663` is mainnet and is rejected.

## Develop

```bash
npm install
npm run build
npm run lint
npm run circuit:setup   # compiles the circuit and runs a dev-only setup
npm test
npm run audit
```

`npm run circuit:setup` needs the `circom` 2.2.x binary on `PATH`. It also
writes `contracts/evm/src/Verifier.sol`. The setup is single-party. Re-run it
with `--force` after changing the circuit. Artifacts under `circuits/build/`
are not committed.

```bash
cd contracts/evm && forge install foundry-rs/forge-std --no-git && forge test
cargo test --manifest-path contracts/shade-crypto/Cargo.toml
cargo test --manifest-path contracts/near/Cargo.toml
```

Copy `.env.example` if you want a local Solana key. Never commit a real key.
`SOLANA_KEYPAIR` is a JSON array from `solana-keygen` or 128 hex characters.

Logging goes through `src/core/log/logger.ts`, which redacts secret fields
and does not print raw key bytes. Do not put secrets in the log message string.

## Not production-ready

- The development setup is not a trusted ceremony. Forged proofs are possible
  for anyone who sees the intermediate parameters.
- Tree depth 8 is a devnet limit.
- No external cryptographic audit has been done.
- The EVM verifier, NEAR wasm, and Solana SBF program have not been broadcast.
  The Solana binary only verifies the Groth16 proof; it does not yet update a
  Merkle tree or hold a SOL vault. Its verifying key is the insecure test setup.
- The dark pool is operator-visible.
- Sanctions screening and Groth16 KYC proofs are not implemented.
- `circomlib` and `snarkjs` are GPL-3.0. `LICENSE` is MIT for this
  repository's original code; confirm that combination before you distribute
  a combined work.

Do not point this software at mainnet.
