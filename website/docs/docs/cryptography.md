# Cryptography

> **Status:** devnet/testnet only · **unaudited** · Groth16 keys from a **development trusted setup (not secure)** · parameters subject to change. This page specifies the target design. The repository is authoritative for exact constants, encodings and domain tags. *TODO (owner): confirm every parameter marked "target" against the merged implementation.*

## 1. Notation and primitives

| Symbol | Meaning |
|---|---|
| $\mathbb{F}_p$ | BN254 scalar field, $p = 21888242871839275222246405745257275088548364400416034343698204186575808495617$ |
| $H(\cdot)$ | Poseidon hash over $\mathbb{F}_p$ (circomlib parameters), arity = number of inputs |
| $\mathsf{DOM}_x$ | A fixed domain-separation constant in $\mathbb{F}_p$ for purpose $x$ |
| $\mathbb{G}$, $B$, $\ell$ | Baby Jubjub twisted Edwards curve (embedded in BN254), base point $B$, prime subgroup order $\ell$ |
| $\xleftarrow{\$}$ | Sampled uniformly at random from a CSPRNG |
| $\mathsf{HKDF}$ | HKDF-SHA256 (RFC 5869) |
| $\mathsf{AEAD}$ | AES-256-GCM, 96-bit nonce, 128-bit tag |

Why these choices: Poseidon and Baby Jubjub are cheap inside a BN254 arithmetic circuit; BN254 pairings are available natively on Solana (alt_bn128 syscalls), NEAR (alt_bn128 host functions) and EVM chains (precompiles 0x06–0x08). Symmetric encryption happens outside the circuit, so standard AES-GCM and HKDF are used there.

Every hash includes a distinct domain tag so a value computed for one purpose can never be reused as another.

## 2. Keys and addresses

A user's key material is derived from one random seed.

$$
\begin{aligned}
sk &\xleftarrow{\$} \mathbb{F}_p && \text{spending key (never leaves the device)}\\
pk &= H(\mathsf{DOM}_{pk},\ sk) && \text{spend public key}\\
v &\xleftarrow{\$} \mathbb{Z}_\ell,\quad V = v \cdot B && \text{viewing key pair}\\
\mathsf{addr} &= (pk,\ V) && \text{shielded address (shareable)}
\end{aligned}
$$

- Knowing $sk$ lets you **spend**. Knowing $v$ lets you **see** (decrypt incoming notes) but not spend.
- The shielded address is published or shared once; it never appears on-chain.

## 3. Stealth addressing (one-time owners)

To pay $\mathsf{addr} = (pk, V)$, the sender derives a fresh, unlinkable owner value for each output note using ECDH on Baby Jubjub:

$$
\begin{aligned}
e &\xleftarrow{\$} \mathbb{Z}_\ell,\qquad E = e\cdot B && \text{ephemeral key (published with the note)}\\
S &= e\cdot V = v\cdot E && \text{shared point}\\
s &= S.x && \text{shared secret}\\
\tau &= H(\mathsf{DOM}_{tag},\ s) && \text{stealth tweak}\\
\mathsf{owner} &= H(\mathsf{DOM}_{own},\ pk,\ \tau) && \text{one-time owner}
\end{aligned}
$$

Properties:

- Different payments to the same address produce unrelated $E$ and $\mathsf{owner}$ values.
- The recipient recovers $s$ from $E$ with $v$, recomputes $\tau$ and $\mathsf{owner}$, and confirms the note is theirs.
- The **sender** knows $\tau$ and $pk$ but **not** $sk$, so they can recognise the note but can never spend it or compute its nullifier.
- Implementations must reject $E$ not in the prime-order subgroup (small-subgroup attacks) and must never reuse $e$.

**View tag (scanning optimisation).** Each note also publishes $\mathsf{vt} = \mathrm{SHA256}(\texttt{"shade/v1/view-tag"} \,\|\, s)[0]$ (one byte). Recipients compute $s$ and compare $\mathsf{vt}$ before attempting decryption, discarding ~255/256 of foreign notes cheaply. This leaks 8 bits that let a viewing-key holder filter quickly; it leaks nothing to anyone else.

## 4. Notes and commitments

A note is the tuple

$$
\mathsf{note} = (\mathsf{asset},\ \mathsf{value},\ \mathsf{owner},\ r),\qquad 0 \le \mathsf{value} < 2^{64},\quad r \xleftarrow{\$} \mathbb{F}_p
$$

Its commitment, the only part stored on-chain, is

$$
C = H(\mathsf{DOM}_{note},\ \mathsf{asset},\ \mathsf{value},\ \mathsf{owner},\ r)
$$

- **Hiding.** Because $r$ is uniformly random and fresh per note, $C$ reveals nothing about asset, value or owner (modelling Poseidon as a random oracle).
- **Binding.** Opening $C$ to a different tuple requires a Poseidon collision.
- The blinding $r$ must be generated fresh by a CSPRNG for every note; never derive it from the value or reuse it.

> Earlier scaffold code used `value + blinding` and a sum of character codes as "commitments". Those are neither hiding nor binding and have been replaced.

## 5. Nullifiers

When a note at leaf index $i$ is spent, the spender reveals

$$
\mathsf{nf} = H(\mathsf{DOM}_{nf},\ sk,\ C,\ i)
$$

- **Deterministic:** the same note always yields the same $\mathsf{nf}$, so a second spend is caught by the on-chain nullifier set.
- **Unique per note:** including $C$ and $i$ means two notes never share a nullifier, even if the same user owns many notes with equal values.
- **Unlinkable:** without $sk$, $\mathsf{nf}$ cannot be linked to $C$ or $i$.
- **Owner-only:** requires $sk$, which the sender of a note never learns.

The circuit proves $\mathsf{nf}$ was computed correctly from the same $sk$ that controls $\mathsf{owner}$.

## 6. Commitment Merkle tree

All commitments are appended to a binary, incremental Poseidon Merkle tree of depth $D$ (target $D = 20$, i.e. $2^{20} \approx 1.05$ million notes per pool).

$$
\begin{aligned}
Z_0 &= H(\mathsf{DOM}_{zero}) && \text{empty leaf}\\
Z_{k+1} &= H(Z_k,\ Z_k) && \text{empty subtree of height } k+1\\
\mathsf{node}_{k+1} &= H(\mathsf{left}_k,\ \mathsf{right}_k)
\end{aligned}
$$

A membership proof for leaf $C$ at index $i$ is the list of sibling hashes $(\sigma_0,\dots,\sigma_{D-1})$ and the bits of $i$, $b_k = \lfloor i / 2^k \rfloor \bmod 2$:

$$
h_0 = C,\qquad
h_{k+1} = \begin{cases} H(h_k,\ \sigma_k) & b_k = 0\\ H(\sigma_k,\ h_k) & b_k = 1\end{cases},\qquad
h_D \stackrel{?}{=} \mathsf{root}
$$

- The incremental tree stores only $D$ "filled subtree" hashes on-chain, so inserts cost $O(D)$ hashes.
- The contract keeps a ring buffer of recent roots (target: 100). A proof is accepted if it references any root in the buffer.
- Off-chain clients rebuild the full tree from `NoteCommitted` events.

## 7. Note encryption

Each output note is encrypted so only its recipient (and, if the pool requires it, a designated auditor — see [compliance.md](compliance.md)) can read it.

$$
\begin{aligned}
k_{enc} &= \mathsf{HKDF}\big(\mathsf{ikm}=s,\ \mathsf{salt}=\mathrm{enc}(E),\ \mathsf{info}=\texttt{"shade/v1/note-enc"},\ L=32\big)\\
\eta &\xleftarrow{\$} \{0,1\}^{96}\\
\mathsf{ct} &= \mathsf{AEAD.Enc}\big(k_{enc},\ \eta,\ \mathsf{pt}=(\mathsf{asset},\mathsf{value},r,\mathsf{memo}),\ \mathsf{aad}=C\big)
\end{aligned}
$$

Published per output: $(C,\ E,\ \mathsf{vt},\ \eta,\ \mathsf{ct})$.

- The key comes from ECDH + HKDF, never from raw secrets. (The earlier scaffold used the first 32 bytes of the sender's secret as an AES key; that is replaced.)
- Binding $C$ as associated data stops ciphertexts being transplanted onto other commitments.
- After decryption, the recipient recomputes $\mathsf{owner}$ and $C$ and **discards the note unless $C$ matches** — so a malicious sender cannot make a recipient believe in a note that does not exist on-chain.
- A fresh $e$ per note means a fresh $k_{enc}$, so nonce reuse across notes is not catastrophic; nonces are still random.

## 8. Zero-knowledge proofs

Shade uses **Groth16** over BN254 (via Circom + snarkjs). For a relation $\mathcal{R}$ with public inputs $x$ and private witness $w$, the prover outputs $\pi = (A, B, C) \in \mathbb{G}_1 \times \mathbb{G}_2 \times \mathbb{G}_1$ (~256 bytes compressed). The verifier checks one pairing equation:

$$
e(A, B) = e(\alpha, \beta)\cdot e\Big(\textstyle\sum_{j} x_j \cdot \mathrm{IC}_j,\ \gamma\Big)\cdot e(C, \delta)
$$

- **Succinct:** constant-size proof, constant-time verification — cheap on-chain.
- **Zero-knowledge:** $\pi$ reveals nothing about $w$ beyond the truth of the statement.
- **Trusted setup:** $(\alpha,\beta,\gamma,\delta)$ and the proving key come from a setup ceremony. Whoever knows the setup "toxic waste" can forge proofs. The current keys come from a **single-party development setup and must be considered compromised.** A public multi-party ceremony (Powers of Tau phase 1 + circuit-specific phase 2) is a hard prerequisite for mainnet. See [security.md](security.md).

The statement proved is specified in [circuits.md](circuits.md).

## 9. Domain tags (target)

| Tag | Use |
|---|---|
| $\mathsf{DOM}_{pk}$ | spend public key |
| $\mathsf{DOM}_{tag}$ | stealth tweak |
| $\mathsf{DOM}_{own}$ | one-time owner |
| $\mathsf{DOM}_{note}$ | note commitment |
| $\mathsf{DOM}_{nf}$ | nullifier |
| $\mathsf{DOM}_{zero}$ | empty Merkle leaf |
| $\mathsf{DOM}_{ext}$ | external-data hash |
| $\mathsf{DOM}_{cred}$ | KYC credential commitment |

*TODO (owner): publish the exact numeric values (e.g. derived as `keccak256("shade.v1.<name>") mod p`) once fixed in code.*

## 10. Security notes

- BN254 is estimated at roughly 100–128 bits of classical security. None of these primitives are post-quantum; a large quantum computer could break ECDH (privacy of past notes) and Groth16 soundness.
- All randomness ($sk$, $v$, $e$, $r$, $\eta$) must come from a CSPRNG. Weak randomness breaks privacy.
- Poseidon parameters must match exactly between circuit, SDK and contracts; mismatches cause un-spendable notes, not theft, but are still severe.
