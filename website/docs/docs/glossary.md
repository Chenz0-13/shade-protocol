# Glossary

**Adapter (chain adapter)** — The thin, chain-specific component that verifies proofs, stores roots and nullifiers, and holds pooled tokens on one blockchain.

**AEAD / AES-256-GCM** — Authenticated encryption: encrypts data and detects any tampering. Used for note and order ciphertexts.

**Anonymity set** — The group of users or notes among which a given transaction could plausibly belong. Bigger is more private.

**Auditor ciphertext** — An optional extra encryption of a note's details to a designated auditor key, enabled only by visible pool policy.

**Baby Jubjub** — An elliptic curve designed to be efficient inside BN254 zero-knowledge circuits. Used for viewing keys, ECDH and EdDSA signatures.

**Batch (matching batch)** — A short time window after which the dark-pool matcher processes all collected orders together.

**BN254 (alt_bn128)** — The pairing-friendly elliptic curve used by Groth16 here; natively supported on Solana, NEAR and EVM chains.

**Circom** — A language for writing arithmetic circuits for zero-knowledge proofs.

**Commitment** — A public fingerprint of a note that hides its contents (*hiding*) and cannot later be opened to different contents (*binding*).

**Dark pool** — A venue where orders are not publicly visible before execution.

**Devnet / testnet** — Public test networks with valueless tokens. Shade runs only here.

**Disclosure bundle** — A user-generated, verifiable package revealing specific notes to a chosen party.

**ECDH** — Elliptic-curve Diffie–Hellman: two parties derive a shared secret from one's private key and the other's public key.

**Ephemeral key** — A one-time key the sender generates per note so the recipient can derive the shared secret.

**Front-running** — Trading ahead of a known pending order to profit from its price impact.

**Groth16** — A zk-SNARK proving system with very small proofs and cheap verification, requiring a trusted setup per circuit.

**HKDF** — A standard key-derivation function that turns a shared secret into encryption keys.

**Join-split** — A transaction shape that consumes some notes and creates new ones, proving value is conserved.

**KYC credential** — A signed statement from an issuer about a user (e.g. level, jurisdiction, expiry), provable in zero knowledge.

**Merkle tree / root** — A hash tree whose single root summarises every commitment; membership can be proved with a short path.

**MEV (maximal extractable value)** — Profit available to whoever controls transaction ordering, e.g. via sandwich attacks.

**Note** — A unit of shielded value: asset, amount, one-time owner and random blinding.

**Nullifier** — A unique tag revealed when a note is spent; prevents double-spending without revealing which note was spent.

**Poseidon** — A hash function designed to be cheap inside zero-knowledge circuits.

**Range check** — A circuit constraint proving a number lies in a range (here below 2⁶⁴), preventing modular-arithmetic overflow tricks.

**Relayer** — An optional service that submits your transaction and pays gas, so your public wallet isn't linked to it.

**Screening hook** — A plug-in point where an integrator can check public addresses at deposit/withdraw against a provider of their choosing.

**Shielded address** — A shareable address made of a spend public key and a viewing public key; never appears on-chain.

**Shielded pool** — The on-chain contract/program holding all notes' backing tokens, the commitment tree and the nullifier set.

**Spending key** — The secret that authorises spending notes. Never share it.

**Stealth address** — A one-time owner value derived per payment so payments to the same person cannot be linked.

**Trusted setup (ceremony)** — The process generating Groth16 parameters. Secure if at least one participant destroys their secret randomness.

**Viewing key** — A secret that decrypts a user's incoming notes but cannot spend them.

**View tag** — A one-byte hint that lets recipients skip most notes that aren't theirs while scanning.

**Witness** — The private inputs to a circuit that the prover knows and the proof hides.

**Zero-knowledge proof (ZKP)** — A proof that a statement is true which reveals nothing else.
