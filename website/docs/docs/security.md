# Security

> **Status: experimental, unaudited, devnet/testnet only.** Do not use Shade Protocol with real funds. The Groth16 proving keys come from a **development trusted setup** and must be treated as compromised.

## 1. Security goals

| Goal | Meaning |
|---|---|
| **Soundness / no inflation** | Nobody can create value or spend a note they don't own |
| **No double-spend** | Each note can be spent once |
| **Transaction privacy** | Observers learn nothing about sender, recipient, amount or asset beyond public amounts at deposit/withdraw |
| **Order privacy** | The public learns nothing about dark-pool orders beyond their existence |
| **Spend/view separation** | Viewing keys and disclosure bundles never allow spending |
| **Non-custodial** | No operator, relayer or matcher can move user funds |

## 2. Threat model

| Adversary | Capabilities assumed | Protected? |
|---|---|---|
| Passive chain observer | Reads all on-chain data and mempool | Amounts, owners, links between notes, order contents |
| Front-runner / MEV searcher | Reorders, inserts transactions | Nothing to act on: orders and settlements are opaque |
| Malicious relayer | Sees submitted txs, can delay or drop | Cannot change recipient, fee or outputs (bound by `extDataHash`); can censor |
| Malicious sender | Crafts bad ciphertexts | Recipient verifies commitment before accepting a note; cannot spend recipient's note |
| Dark-pool matcher | Sees orders it matches; controls batching | Cannot steal; **can** leak order info, censor or order unfairly |
| Compromised viewing key | Decrypts that user's notes | Cannot spend |
| Compromised spending key | Full control of that user's notes | **Not protected** |
| Trusted-setup participant(s) | If all collude / keep toxic waste | **Not protected** — could forge proofs and mint value |
| Network observer | Sees IP addresses and timing | **Not protected** by the protocol — use a relayer and Tor/VPN |

## 3. Trust assumptions

1. Poseidon, BN254 pairings, Baby Jubjub ECDH, HKDF-SHA256 and AES-256-GCM are secure as standardly assumed.
2. At least one participant in the Groth16 setup ceremony was honest. **Currently false by design** (single-party dev setup).
3. The circuits are fully constrained and the on-chain verifier and contract logic are correct.
4. The host chain is live, finalises transactions and does not censor indefinitely.
5. The dark-pool matcher is trusted for confidentiality, liveness and fairness (not funds).
6. KYC issuers, where used, perform their checks honestly; Shade cannot verify this.
7. Users' devices are not compromised and generate good randomness.

## 4. Known limitations

- **Unaudited.** No independent security audit has been performed.
- **Development trusted setup.** Proofs from current keys are not secure.
- **Small anonymity set.** On devnet, few users means little real privacy; statistical analysis of timing and amounts can link deposits and withdrawals.
- **Deposit/withdraw linkage.** Public amounts and timing at the edges are visible.
- **Matcher trust.** See [dark-pool.md](dark-pool.md#3-trust-model).
- **Auditor ciphertexts not yet circuit-enforced** (see [compliance.md](compliance.md#43-regulator--auditor-view-keys-pool-policy)).
- **Screening hook is advisory** in the SDK and can be bypassed by custom clients unless pool policy enforces an on-chain attestation (planned).
- **Not post-quantum.** A future quantum computer could break ECDH (exposing past note contents) and Groth16 soundness.
- **Adapters beyond Solana** may be incomplete; behaviour on those chains is untested.
- **Key loss is final.** There is no recovery mechanism for lost spending keys.
- **Upgradability.** *TODO (owner): document who (if anyone) can upgrade the devnet program, and the plan for upgrade authority on any future mainnet deployment.*

## 5. History: issues fixed from the original scaffold

The first scaffold (commit `fd76e28`) was a prototype and should not be used. Issues identified in review and addressed by the rewrite include:

- Merkle tree used XOR instead of a hash; membership proofs always returned true.
- Circuit membership and commitment constraints were placeholders (`valid <== 1`, `value + blinding`).
- Proofs were mocked; chain submissions returned fake transaction hashes.
- Note encryption keyed AES directly with the sender's secret.
- Nullifiers were derived from value rather than the note, risking collisions.
- Dark-pool matching ignored order side, could match one order repeatedly and produced no output notes.
- KYC "proofs" were constant values; regulator "view keys" were base64 strings.

## 6. Responsible disclosure

If you find a vulnerability, please **do not** open a public issue.

- Email: **TODO-security@example.com** *(TODO (owner): replace with a real, monitored security address)*
- PGP key: *TODO (owner): optional — publish fingerprint*
- Please include: affected component and commit, reproduction steps, impact, and whether it has been disclosed elsewhere.
- We aim to acknowledge reports within **TODO (owner): e.g. 3 business days** and to agree a disclosure timeline with you.
- There is currently **no bug bounty**. *TODO (owner): update if a bounty is launched.*

Because the protocol is devnet-only, there are no user funds at risk today; we still treat reports seriously and will credit reporters who wish to be named.

## 7. Before any mainnet

All of the following are required, in order:

1. Feature-complete code with full unit, circuit (including negative) and integration tests in CI.
2. Independent audit(s) of circuits, cryptography, contracts and SDK; findings fixed and reports published.
3. Public multi-party trusted-setup ceremony with published transcripts.
4. Staged rollout with conservative deposit caps.
