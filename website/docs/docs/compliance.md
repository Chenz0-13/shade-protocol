# Compliance tooling

> **Status:** devnet/testnet only · **unaudited** · interfaces subject to change.
>
> **Important.** The features on this page are **tools for selective disclosure and policy enforcement**. Using them does not, by itself, make any deployment, operator or user compliant with any law or regulation. Shade Protocol has not been reviewed or approved by any regulator. Operators should obtain their own legal advice.

## 1. Principles

1. **Private by default.** Without a deliberate disclosure, notes and orders reveal nothing beyond what is described in [security.md](security.md).
2. **Disclosure is explicit and scoped.** Users choose what to reveal, to whom, and for which period.
3. **Pool policy is public.** Any requirement (KYC proofs, auditor ciphertexts, screening) is fixed at pool creation and readable on-chain, so users know the rules before depositing.
4. **Policy at the edges, not in the core.** Compliance checks happen at deposit, withdrawal and order admission. The core state transition (proofs, nullifiers, tree) is identical for every pool.

## 2. Pool policy

```ts
// Illustrative — see the SDK for the canonical type.
interface PoolPolicy {
  requireKycProof?: { issuerSetRoot: bigint; minLevel: 1 | 2 | 3; jurisdictionSetRoot: bigint };
  auditor?: { publicKey: BabyJubPoint; label: string };   // enables auditor ciphertexts
  screening?: { onDeposit: boolean; onWithdraw: boolean; hookId: string };
}
```

A pool with no policy is fully permissionless. Policies are immutable once a pool is created; changing policy means creating a new pool.

## 3. Zero-knowledge KYC credentials

### Roles

- **Issuer** — an organisation that performs identity checks off-chain, by its own process, and issues credentials. Shade does not perform KYC and does not choose issuers. *TODO (owner): no issuers are integrated today; do not name any until there is a written agreement.*
- **Holder** — the user.
- **Verifier** — a pool (via its policy) or any third party that checks the proof.

### Credential

$$
\mathsf{cred} = H(\mathsf{DOM}_{cred},\ pk,\ \mathsf{level},\ \mathsf{jurisdiction},\ \mathsf{expiry},\ \mathsf{nonce})
$$

The issuer signs $\mathsf{cred}$ with an EdDSA-Poseidon key on Baby Jubjub and gives the holder the opening and signature. Nothing is published on-chain at issuance. Accepted issuer public keys are collected in a Merkle tree with root `issuerSetRoot`; allowed jurisdiction codes in a tree with root `jurisdictionSetRoot`.

### Proof

The [KYC circuit](circuits.md#4-kyc-credential-circuit) proves:

- the signature on $\mathsf{cred}$ verifies under an issuer key in `issuerSetRoot`;
- $\mathsf{level} \ge$ `minLevel`;
- $\mathsf{expiry} >$ `currentTime` (supplied by the contract from the chain clock);
- $\mathsf{jurisdiction} \in$ `jurisdictionSetRoot`;
- the credential is bound to the same $pk$ that spends the note (so credentials cannot be lent to other keys).

Revealed: only that the statement is true, plus an optional per-scope nullifier $H(\mathsf{DOM}_{cred\text{-}nf}, sk, \mathsf{scope})$ that lets a pool rate-limit or revoke without linking the user across pools.

**Revocation.** Issuers may publish a revocation list as a sparse Merkle tree; the circuit then additionally proves non-membership. *Planned, not yet implemented.*

> The original scaffold "proved" KYC with hard-coded dummy proof values and identified users by summing character codes. That code has been replaced; treat any build that still contains it as insecure.

## 4. Viewing keys and disclosure

### 4.1 Full viewing key

The viewing key $v$ (see [cryptography.md §2](cryptography.md#2-keys-and-addresses)) decrypts **all** notes ever sent to the user's address. It cannot spend. Sharing it is irrevocable for the past and ongoing for the future (until the user moves to a new address).

### 4.2 Scoped disclosure bundles (recommended)

For most audits, the user should not share $v$. Instead the SDK produces a **disclosure bundle** for a chosen scope (time range, asset, or specific notes):

$$
\mathsf{bundle} = \big\{\,(i,\ C_i,\ \mathsf{asset}_i,\ \mathsf{value}_i,\ \mathsf{owner}_i,\ r_i,\ \mathsf{nf}_i?)\,\big\}_{i \in \text{scope}}
$$

The recipient (auditor, accountant, regulator) can verify each entry independently by recomputing $C_i$ and checking it is in the on-chain tree at index $i$, and (if included) that $\mathsf{nf}_i$ appears in the nullifier set — proving the note was spent. A bundle reveals nothing outside its scope. Bundles can be encrypted to the auditor's public key.

### 4.3 Regulator / auditor view keys (pool policy)

If a pool sets `auditor.publicKey` $= Q$, every output note in that pool also carries an **auditor ciphertext**: the note opening encrypted to $Q$ with a separate ephemeral key, using a Poseidon-based stream cipher so it can be checked inside the circuit.

$$
E_a = e_a \cdot B,\quad s_a = (e_a \cdot Q).x,\quad \mathsf{ct}_a = (\mathsf{asset},\mathsf{value},\mathsf{owner}) + \mathsf{PoseidonKeystream}(s_a)
$$

- The holder of the auditor key can decrypt amounts and one-time owners for that pool only. They **cannot spend**.
- Counterparty linkage still requires the users' own disclosure, because one-time owners do not reveal shielded addresses.
- This is visible pool policy, not a hidden backdoor. Pools without an auditor key do not produce auditor ciphertexts.
- Key custody for the auditor key (e.g. threshold-split between several parties, time-limited rotation) is the operator's responsibility.

**Status:** *in-circuit enforcement of auditor ciphertexts is planned; until it is implemented, auditor ciphertexts are produced by honest clients and are not cryptographically enforced.* *TODO (owner): update this line when the circuit enforces it.*

> The scaffold's `generateRegulatoryViewKey` produced a base64 string of the regulator ID and wallet range — not a key at all. It has been replaced by the mechanisms above.

## 5. Sanctions-screening hook

Deposits and withdrawals are the points where public addresses meet the shielded pool. The SDK and relayer expose a pluggable hook:

```ts
// Illustrative
interface ScreeningProvider {
  id: string;
  check(input: { chain: string; address: string; direction: "deposit" | "withdraw"; amount?: bigint })
    : Promise<{ allow: boolean; reason?: string; reference?: string }>;
}
client.compliance.registerScreeningProvider(myProvider);
```

- Shade ships the **interface and a no-op default**; it does **not** ship, maintain or endorse any sanctions list or screening vendor.
- Where enforced: in the SDK/relayer (advisory, bypassable by a user running their own client), and optionally on-chain via an allow/deny attestation required by pool policy (*planned*).
- Results are not written on-chain by default, to avoid publishing personal data.

## 6. What these tools do not do

- They do not identify users to anyone without the user's (or the pool policy's) explicit disclosure.
- They do not guarantee that an issuer's checks were adequate.
- They do not make the protocol, any pool or any user "compliant" or "approved".
