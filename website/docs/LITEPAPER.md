# Shader Protocol litepaper

Status: Not audited. Devnet/testnet only. No token. No mainnet.

This note describes the code as it stands and the work that is only in development. It is not an offer, and it does not promise a date.

## What the code does now

Shader Protocol is a Groth16 shielded pool.

A transfer spends one input note and creates two output notes plus a fee:

`value in = value out 1 + value out 2 + fee`

Commitments are Poseidon hashes. The nullifier is bound to the commitment and the leaf index, so the same note cannot be spent twice. `extDataHash` binds the recipient, the relayer, the fee, the chain, and the pool. The contract recomputes that hash from the values it actually uses, so a proof paid somewhere else does not match. Public inputs are canonical field elements. Pools keep a root history, and a proof has to cite a root that is still in that history.

Incoming notes use secp256k1 stealth addresses. A view key can recognize a note and decrypt it. It does not derive the spending key. Regulator keys are secp256k1 as well: an issuer-signed encryption key plus a scope.

The dark pool in this repository is an operator matcher. Orders are sealed to the operator, who can open them in order to build the two settlement proofs. That is a devnet tool. It does not mean a public mempool cannot front-run, and it is not a custody design for someone else's funds.

Zero-knowledge KYC proofs are not implemented. The client rejects `generateGroth16KycProof` on purpose. Treat that idea as planned at most.

## Chains

The adapters below are in development. None of them is deployed.

| Chain | What it is |
| --- | --- |
| Solana devnet | Shielded pool program |
| Robinhood Chain testnet (chain id 46630) | Same pool shape on an EVM testnet |
| Kinetiq Elysium testnet (chain id 99801) | Same pool shape on an EVM testnet |
| NEAR testnet | Same pool shape |
| Canton | 2-of-N attestation, not a proof verifier |

Canton does not check the Groth16 proof. A result is recorded only when two named attestors authorize it. The trust assumption is those attestors. They are expected to sign only after a pool has already accepted the spend. If two of them sign a result that never happened, Canton records it anyway. The TypeScript adapter does not submit to Canton.

Naming a chain here is an engineering target. Shader Protocol has no partnership with any of them.

## In development

Not shipped, and not deployed:

- HyperEVM testnet
- Base Sepolia
- A v2 universal note format
- Private cross-chain teleport, where two transports must agree, with per-epoch caps
- Disclosure receipts
- Agent allowance notes
- Private payroll
- A multi-party trusted setup ceremony
- A CI security toolchain

## Security

The Groth16 keys are a single-party development setup. Anyone who kept the intermediate parameters can forge proofs. Do not protect real value with them.

Not audited. Devnet and testnet only. There is no mainnet deployment.

Planned path, with no dates: a multi-party ceremony, then an independent audit, then a guarded beta with caps. A later step starts when the previous one is actually finished, not because a calendar says so.

Report a vulnerability in private: <https://github.com/Chenz0-13/shade-protocol/security/advisories/new>

Do not open a public issue for an unfixed security bug. The repository is still <https://github.com/Chenz0-13/shade-protocol> until it is renamed.

## Token

A possible utility token is under design for relayer and attestor bonding; no token exists and none is offered. Any launch would follow legal review.

## Roadmap

No dates are promised.

1. **Now.** Groth16 shielded pool in development, not yet deployed, on the chains listed above.
2. **Next build.** The in-development items listed above, including HyperEVM testnet, Base Sepolia, the v2 note format, and private cross-chain teleport.
3. **Ceremony.** Multi-party trusted setup. Not started.
4. **Independent audit.** Not started. The code is not audited today.
5. **Guarded beta with caps.** Only after the ceremony and the audit.

## More

HTML notes live under `docs/`. Source: <https://github.com/Chenz0-13/shade-protocol>
