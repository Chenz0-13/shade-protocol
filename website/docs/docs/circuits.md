# Circuits

> **Status:** devnet/testnet only · **unaudited** · **development trusted setup — proofs from these keys are not secure** · interfaces subject to change. Circuit sources live in [`circuits/`](https://github.com/Chenz0-13/shade-protocol/tree/main/circuits). Notation follows [cryptography.md](cryptography.md).

## 1. Overview

| Circuit | Purpose | Used by |
|---|---|---|
| `transaction` (2-in / 2-out) | Deposits, transfers and withdrawals: membership, ownership, nullifiers, output well-formedness, conservation, range checks | Shielded pool |
| `settlement` | Atomically settles one matched dark-pool trade between two parties | Dark pool |
| `kyc_credential` | Proves properties of an issuer-signed credential without revealing it | Compliance layer |

All circuits are written in Circom 2, use circomlib's `Poseidon`, `Num2Bits`, `BabyAdd`/`EscalarMulAny` and `EdDSAPoseidonVerifier`, and are proved with Groth16 on BN254.

*TODO (owner): add measured constraint counts, proving times (browser/Node) and verifier costs per chain once benchmarks exist. Do not publish estimates as measurements.*

## 2. Transaction circuit

A "join-split" with two input slots and two output slots. Unused input slots carry zero-value dummy notes; unused output slots carry zero-value notes to the sender. This keeps every transaction the same shape, so a deposit, a transfer and a withdrawal look alike to observers apart from `publicAmount`.

### Public inputs

| Name | Meaning |
|---|---|
| `root` | A Merkle root from the contract's recent-roots buffer |
| `nf[2]` | Nullifiers of the two inputs |
| `cOut[2]` | Commitments of the two outputs |
| `publicAmount` | Net value entering (+) or leaving (−) the pool, encoded in $\mathbb{F}_p$ as $(\text{amount} \bmod p)$ |
| `asset` | Asset identifier for this pool |
| `extDataHash` | $H(\mathsf{DOM}_{ext}, \text{recipient}, \text{relayer}, \text{fee}, H(\text{ciphertexts}))$ — binds off-circuit data |

### Private inputs

Per input $j$: `value`, `r`, `pk`-derivation secret `sk`, stealth tweak `tau`, `leafIndex`, `path[D]`. Per output $k$: `value`, `r`, `owner`.

### Constraints

For each input $j \in \{0,1\}$:

1. **Ownership.** $pk_j = H(\mathsf{DOM}_{pk}, sk)$ and $\mathsf{owner}_j = H(\mathsf{DOM}_{own}, pk_j, \tau_j)$.
2. **Commitment.** $C_j = H(\mathsf{DOM}_{note}, \mathsf{asset}, \mathsf{value}_j, \mathsf{owner}_j, r_j)$.
3. **Membership.** Recompute the Merkle root from $C_j$, `leafIndex_j` and `path_j` (index bits via `Num2Bits(D)`); require it equals `root` **unless** $\mathsf{value}_j = 0$ (dummy input). Enforced as $(\text{computedRoot}_j - \text{root}) \cdot \mathsf{value}_j = 0$.
4. **Nullifier.** $\mathsf{nf}_j = H(\mathsf{DOM}_{nf}, sk, C_j, \text{leafIndex}_j)$.

For each output $k \in \{0,1\}$:

5. **Well-formed output.** $\mathsf{cOut}_k = H(\mathsf{DOM}_{note}, \mathsf{asset}, \mathsf{value}'_k, \mathsf{owner}'_k, r'_k)$.
6. **Range.** $\mathsf{value}'_k < 2^{64}$ via `Num2Bits(64)`. Inputs are range-checked the same way.

Across the transaction:

7. **Conservation.** $\mathsf{value}_0 + \mathsf{value}_1 + \mathsf{publicAmount} = \mathsf{value}'_0 + \mathsf{value}'_1$ (the fee is paid from `publicAmount` on withdrawal, and is bound via `extDataHash`).
8. **Distinct nullifiers.** $\mathsf{nf}_0 \neq \mathsf{nf}_1$ (enforced in-circuit with an inverse witness, and again by the contract).
9. **Binding external data.** `extDataHash` is a public input; a dummy square constraint ensures it is part of the proof, so a relayer cannot change recipient, fee or ciphertexts without invalidating it.

Range checks matter: all arithmetic is modulo $p$, so without them a negative "value" such as $p-1$ could be used to mint funds. With every value below $2^{64}$ and at most four terms per side, sums cannot wrap.

The contract additionally checks: `root` is in the buffer, neither nullifier is already spent, `publicAmount` matches the actual token movement, and `asset` matches the pool.

### Sketch

```circom
pragma circom 2.1.6;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

template Transaction(D) {
    signal input root, nf[2], cOut[2], publicAmount, asset, extDataHash;   // public
    signal input sk, inValue[2], inR[2], inTau[2], inIndex[2], inPath[2][D];
    signal input outValue[2], outR[2], outOwner[2];

    // pk and per-input owner, commitment, Merkle root, nullifier ...
    // range checks: Num2Bits(64) on every value
    // conservation:
    inValue[0] + inValue[1] + publicAmount === outValue[0] + outValue[1];
}
component main { public [root, nf, cOut, publicAmount, asset, extDataHash] } = Transaction(20);
```

This sketch is illustrative; the repository's circuit is canonical.

## 3. Settlement circuit (dark pool)

Settles one match between a buyer (pays quote asset $Q$, receives base asset $B$) and a seller (the reverse), at execution price $P$ for base quantity $q$.

**Public:** `root`, `nfBuy`, `nfSell`, the output commitments (buyer receives base + quote change; seller receives quote + base change), `matchId`, `extDataHash`.

**Private:** both input notes and their membership paths, both order openings (side, limit price, size, order secret), the execution price $P$ and fill quantity $q$, output openings.

**Constraints:**

1. Both input notes are members of the tree and their nullifiers are correctly derived (as in §2).
2. Both orders are opened against their on-chain order commitments (see [dark-pool.md](dark-pool.md)) and are **opposite sides** of the **same pair**.
3. **Price compatibility:** $P \le \text{limit}_{buy}$ and $P \ge \text{limit}_{sell}$.
4. **Size:** $q \le \text{size}_{buy}$ and $q \le \text{size}_{sell}$, and $q > 0$.
5. **Conservation per asset:**
   - Buyer: $\mathsf{in}^Q_{buy} = q \cdot P / 10^{d} + \mathsf{change}^Q_{buy}$ and receives $q$ of $B$.
   - Seller: $\mathsf{in}^B_{sell} = q + \mathsf{change}^B_{sell}$ and receives $q \cdot P / 10^{d}$ of $Q$.
   Division is implemented as a multiplication check with a range-checked remainder; $d$ is the fixed price-decimals constant. Rounding is always against the taker of the rounding, never creating value.
6. All values and the remainder are range-checked to 64 bits.

The circuit proves **validity** of a match. It does not prove the match was the **best** available one — that is a matcher fairness assumption (see [dark-pool.md](dark-pool.md#trust-model)).

## 4. KYC credential circuit

Proves, without revealing the credential: "I hold a credential, signed by an accepted issuer, bound to my spend key, of level ≥ L, not expired at time T, with a jurisdiction in the allowed set." Full details in [compliance.md](compliance.md).

**Public:** `issuerSetRoot`, `requiredLevel`, `currentTime`, `jurisdictionSetRoot`, `credNullifier` (optional, per-scope), `bindingHash`.

**Constraints:** EdDSA-Poseidon signature verification of the credential commitment against an issuer key that is a member of `issuerSetRoot`; `level ≥ requiredLevel` (range-checked comparison); `expiry > currentTime`; jurisdiction code is a leaf of `jurisdictionSetRoot`; `bindingHash = H(pk, scope)` ties the proof to the holder.

## 5. Building and the trusted setup

Typical development flow (exact scripts in the repository):

```bash
circom circuits/transaction.circom --r1cs --wasm --sym -o build/
snarkjs groth16 setup build/transaction.r1cs pot_dev.ptau build/transaction_0000.zkey
snarkjs zkey contribute build/transaction_0000.zkey build/transaction_dev.zkey --name="dev"
snarkjs zkey export verificationkey build/transaction_dev.zkey build/transaction_vkey.json
```

> **Development setup only.** A single contributor means that contributor could forge proofs. These artefacts are for devnet/testnet. Production keys require a public multi-party ceremony with published transcripts and an attestation from each participant; at least one honest participant is then sufficient.

## 6. Testing

Each constraint above should have at least one negative test (a witness that violates it and must fail to prove). *TODO (owner): link the circuit test suite and CI badge once merged.*
