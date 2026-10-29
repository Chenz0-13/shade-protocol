# Shade Protocol

Shade Protocol is a privacy-first, multi-chain execution stack for shielded notes, encrypted mempools, dark-pool matching, and compliant settlement.

This repository is organized as a project scaffold and protocol foundation. It brings together:

- a cryptographic core for commitments, nullifiers, stealth-address-style note generation, and encrypted data
- a privacy execution layer for matching and settlement primitives
- a KYC / compliance proof layer
- chain-adapter placeholders for Solana, NEAR, Canton, and Robinhood
- a unified SDK surface for protocol consumers

## Optimized architecture recommendation

The codebase is best structured as a hybrid system:

- Rust-first protocol core
  - note and commitment management
  - nullifier registry
  - Merkle state
  - privacy state transitions
  - proof interfaces and verifier abstractions
- TypeScript SDK layer
  - client-side access to protocol primitives
  - developer ergonomics and local tooling
  - lightweight integration interfaces
- Chain adapters remain thin and isolated
  - Solana, NEAR, Canton, and Robinhood adapters translate protocol state to chain-specific settlement and routing
- Compliance and proof handling remain at the policy and verification boundary
  - KYC / AML gating
  - selective disclosure
  - gateway policy enforcement

This separation is the best optimization for correctness, security, and maintainability.

## Repository layout

```text
privacy-protocol/
├── Cargo.toml
├── README.md
├── crates/
│   ├── core/
│   │   ├── crypto/
│   │   ├── proof/
│   │   ├── note/
│   │   └── error.rs
│   ├── state/
│   │   ├── tree/
│   │   ├── mempool/
│   │   ├── settlement/
│   │   └── registry/
│   ├── modules/
│   │   ├── dark_pool/
│   │   ├── kyc/
│   │   ├── vaults/
│   │   ├── bridge/
│   │   └── governance/
│   ├── adapters/
│   │   ├── solana/
│   │   ├── near/
│   │   ├── canton/
│   │   └── robinhood/
│   ├── gateway/
│   ├── node/
│   ├── cli/
│   ├── benches/
│   └── docs/
├── sdk/
│   ├── package.json
│   └── src/
├── examples/
├── tests/
└── README.md
```

## Core design principles

1. Protocol logic belongs in Rust
   - cryptographic ops
   - proof verification flow
   - state transitions
   - nullifier and commitment tracking

2. SDK and tooling can remain TypeScript
   - client integrations
   - local scripting
   - developer UX

3. Proofs should be backend-agnostic
   - support groth16 / halo2 / custom proof backends behind a common trait

4. Keep chain adapters thin
   - adapters should translate protocol state into chain actions, not own the protocol logic

5. Separate policy from execution
   - compliance checks stay at the gateway and policy layer
   - execution core should accept only validated state and proof objects

## Suggested protocol primitives

```rust
pub struct NoteCommitment([u8; 32]);
pub struct Nullifier([u8; 32]);
pub struct EncryptedValue(Vec<u8>);

pub struct PrivacyNote {
    pub commitment: NoteCommitment,
    pub nullifier: Nullifier,
    pub encrypted_value: EncryptedValue,
    pub stealth_address: [u8; 32],
}
```

```rust
pub trait PrivacyCircuit {
    type PublicInputs: Clone;
    type PrivateInputs: Clone;

    fn generate_proof(
        private: &Self::PrivateInputs,
        public: &Self::PublicInputs,
    ) -> Result<Proof, ProofError>;

    fn verify_proof(
        proof: &Proof,
        public: &Self::PublicInputs,
    ) -> Result<bool, ProofError>;
}
```

## Runtime recommendations

- Use `HashSet` for nullifier lookup in memory
- Use `BTreeMap` for ordered mempool or reveal-window state
- Use typed proofs and typed errors
- Keep cryptographic hot paths in Rust
- Keep external APIs behind a gateway / SDK layer
- Isolate chain-specific logic in adapters

## Production caveats

This repo is a solid architectural scaffold, but production deployment still requires:

- real proof artifacts and verifier wiring
- secure key management and threshold decryption design
- full compliance / policy enforcement
- formal cryptographic review
- chain-specific contracts and runtime deployment

## Current status

This repository currently contains a buildable TypeScript scaffold plus protocol-oriented design modules and placeholders that map cleanly to the final Rust-first architecture recommended above.

## Recommended next step

The next phase should be:

1. create the Rust workspace manifest and crates
2. move protocol primitives into `crates/core`
3. define nullifier, Merkle, note, and mempool state in `crates/state`
4. implement adapter stubs for Solana / NEAR / Canton / Robinhood
5. add real proof-layer interfaces and backend implementations
6. scaffold the gateway and CLI from the protocol core

