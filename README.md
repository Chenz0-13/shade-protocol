# Shader Protocol

The product name is Shader Protocol. Repository paths, the npm package `shade-protocol`, contract names such as `ShadePool`, and the `ShadeClient` SDK class are unchanged.

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
src/core/chain        Solana, NEAR, and Robinhood devnet adapters; Canton attestation only
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

Every adapter defaults to a devnet or testnet. Mainnet is refused by chain id or genesis hash, not by the URL string. Nothing
here has been broadcast to a live network: this environment has no funded
deploy key. The deploy scripts refuse mainnet and read keys from the
environment.

| Chain | What is implemented | How it was tested | Live deploy |
| --- | --- | --- | --- |
| Robinhood Chain testnet (chain id 46630, Arbitrum Orbit) | `contracts/evm` ShadePool: depth-20 Poseidon frontier, nullifier map, Groth16, and an `extDataHash` that binds recipient, relayer, withdraw amount, relayer fee, pool address, and `block.chainid`. TS adapter in `src/core/chain/robinhood.ts`. | `forge test` deposits, pays the recipient and relayer separately, rejects a second spend, rejects the same proof on another pool, and rejects the same proof paid to a different recipient. | Not deployed. `node scripts/deploy-robinhood.mjs` reads `ROBINHOOD_PRIVATE_KEY` from the environment and refuses any chain id other than 46630 or anvil. |
| Kinetiq Elysium testnet (chain id 99801, Arbitrum Orbit settling to HyperEVM testnet) | The same ShadePool bytecode. Gas token is HYPE (18 decimals). The viem chain is `defineChain` in `src/core/chain/elysium.ts`. viem's `elysiumTestnet` export is chain id 1338 and is not used. | The EVM pool tests cover the bytecode. The adapter test checks chain id 99801. | Not deployed. `node scripts/deploy-elysium.mjs` accepts only chain id 99801 and reads `ELYSIUM_PRIVATE_KEY` from the environment. Mainnet is pre-launch and is not configured. RPC `https://testnet-rpc.elysium.kinetiq.xyz`, explorer `https://elysium.kinetiq.xyz/testnet-explorer`, faucet `https://elysium.kinetiq.xyz/testnet-faucet`, Blockscout verify API `https://elysium.kinetiq.xyz/api`. |
| NEAR testnet | `contracts/near` (near-sdk 5.11): depth-20 frontier, canonical nullifier and root keys, Groth16, the same `extDataHash`, and a payout callback. A failed transfer records a refundable claim and leaves the nullifier spent. The verification key is set in `#[init]` and a later set fails. Minimum deposit is set at init. | `cargo test` rejects `n+r`, `+n`, and `-(r-n)` for nullifiers and roots, rejects a second key write and a non-owner write, rejects a real proof paid to a different account, and records a claim when the payout promise fails. | Not deployed. There is no funded testnet account in this environment. `scripts/deploy-near.sh` reads the RPC `status.chain_id` and refuses `mainnet`. |
| Solana devnet | `programs/shade-solana` is a pool: depth-20 Poseidon frontier and root history, nullifier PDAs created with allocate, assign, and transfer, a SOL vault, and an `extDataHash` check over the recipient, fee payer, and pool. | LiteSVM: deposit, real proof, withdraw that pays the recipient and the relayer separately, prefunded nullifier PDA, reused nullifier, unknown root, minimum deposit, and the same proof with a different recipient. | Not deployed. `scripts/deploy-solana.sh` needs `SOLANA_KEYPAIR` with devnet SOL and refuses the mainnet genesis hash. |
| Canton | Not a verifier. `contracts/canton` records a result only when two named attestors authorize it, with a contract key on `(sourceChain, nullifier)`. There is no proof field. The trust assumption is the attestors, who are expected to report a Groth16 result already accepted by the Robinhood pool. The TS adapter still throws. | `dpm test` in `contracts/canton` (Daml SDK 3.6.4). See `docs/canton-attestation.md`. | No. DevNet needs a Super Validator sponsor and an IP allowlist. This environment has no participant. |

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
cd programs/shade-solana && cargo-build-sbf --features insecure-test-setup && cargo test --features insecure-test-setup
cd contracts/canton && dpm build && cd test && dpm test
```

Copy `.env.example` if you want a local Solana key. Never commit a real key.
`SOLANA_KEYPAIR` is a JSON array from `solana-keygen` or 128 hex characters.

Logging goes through `src/core/log/logger.ts`, which redacts secret fields
and does not print raw key bytes. Do not put secrets in the log message string.

## Not production-ready

- The development setup is not a trusted ceremony. Forged proofs are possible
  for anyone who sees the intermediate parameters.
- Tree depth 20 is still a devnet parameter. The keys are a single-party setup.
- No external cryptographic audit has been done.
- The EVM verifier, NEAR wasm, and Solana SBF program have not been broadcast.
  The Solana verifying key is the insecure test setup. The generated key file
  says not to deploy it; this repository still builds it for devnet tests and
  the deploy script refuses mainnet.
- Canton records attestor signatures, not proofs. Two colluding attestors can
  insert a spend the EVM pool never accepted.
- The dark pool is operator-visible.
- Sanctions screening and Groth16 KYC proofs are not implemented.
- `circomlib` and `snarkjs` are GPL-3.0. `LICENSE` is MIT for this
  repository's original code; confirm that combination before you distribute
  a combined work.

Do not point this software at mainnet.
