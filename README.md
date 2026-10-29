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

Configuration defaults to Solana devnet, NEAR testnet, and a loopback Canton
host. Mainnet RPC URLs and the Solana mainnet genesis hash are rejected at
startup and again at submit time.

Solana submission builds, signs, and sends a Memo transaction containing the
public proof inputs. It returns the signature of that signed transaction.
Without `SOLANA_KEYPAIR` it throws, and it does not invent a signature.
NEAR, Canton, and Robinhood throw `NotImplementedError`.

There is no deployed Shade program. The memo is a devnet anchor for the
public inputs, not a verifier.

## Develop

```bash
npm install
npm run build
npm run lint
npm run circuit:setup   # compiles the circuit and runs a dev-only setup
npm test
npm run audit
```

`npm run circuit:setup` needs the `circom` 2.2.x binary on `PATH`. The setup
is single-party. Re-run it with `--force` after changing the circuit. Artifacts
go to `circuits/build/` and are not committed.

Copy `.env.example` if you want a local Solana key. Never commit a real key.
`SOLANA_KEYPAIR` is a JSON array from `solana-keygen` or 128 hex characters.

Logging goes through `src/core/log/logger.ts`, which redacts secret fields
and does not print raw key bytes. Do not put secrets in the log message string.

## Not production-ready

- The development setup is not a trusted ceremony. Forged proofs are possible
  for anyone who sees the intermediate parameters.
- Tree depth 8 is a devnet limit.
- No external cryptographic audit has been done.
- No on-chain verifier or Shade program is deployed.
- The dark pool is operator-visible.
- Sanctions screening and Groth16 KYC proofs are not implemented.
- `circomlib` and `snarkjs` are GPL-3.0. `LICENSE` is MIT for this
  repository's original code; confirm that combination before you distribute
  a combined work.

Do not point this software at mainnet.
