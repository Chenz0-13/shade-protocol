# Shader Protocol security tooling

These scanners run on the devnet and testnet tree. A green run is not an audit, a ceremony, or a mainnet clearance. The pool keys are still a single-party development setup.

Every job in `.github/workflows/security.yml` sets `permissions: contents: read`. The EVM job also sets `security-events: write` because `github/codeql-action/upload-sarif` needs that permission to publish Slither output. The CodeQL workflow uses the same extra permission for the same reason. No job can push to the repository.

## Circuits

| Tool | Pin | What it does |
| --- | --- | --- |
| circom | 2.2.3 | Compiles the circuits. Installer sha256 `85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3`. |
| circomspect | 0.9.0 | Fails on warnings. `circuits/circomspect-allowlist.txt` allows `CS0010` only. |
| constraint snapshot | snarkjs r1cs info | `circuits/constraint-snapshot.json` fails if a count changes. |
| malicious prover | `scripts/malicious-prover.mjs` | Builds an honest witness, then adds 1 to every private signal. The witness calculator must reject each mutation. |
| Picus | commit `138b151d3a388e5b6c040c163e0a1db04f2ceda6` | Under-constraint search. Racket 8.18 (installer sha256 `72dfa7602edfe5bd2761af246709ebe93e0fd7f3a0fe98e39bd00418ab7abc70`) and Z3 4.13.4 (zip sha256 `93f91f9c6f4a00a041c19fc7a74adc1f441c8244ce70d486e19abcd89c6a014b`). |
| fast-check | 4.5.3 | Property tests in `tests/properties.test.ts` for value splits, the 64-bit range, nullifier separation, and extDataHash binding. |

`CS0010` is `non-strict-binary-conversion` inside `Num2Bits`, which `AssertRange` uses for 64-bit values. The bits are checked against the input, so a field-sized alias does not pass the range. `Num2Bits_strict` would add a 254-bit alias check and push the largest circuit past the pinned Powers of Tau. Info-level notes from circomspect are not failures. The default level is warning, and the job fails if a warning is not on the allowlist.

Constraint counts at the time of this note:

| Circuit | Constraints |
| --- | --- |
| `shielded_transfer.circom` | 23017 |
| `transfer.circom` | 32428 |
| `teleport_out.circom` | 19768 |
| `allowance_spend.circom` | 16348 |

`transfer.circom` is the largest and still fits the Hermez pot16 file (65536 constraints). `allowance_spend.circom` is not part of `npm run circuit:setup`. Tests check it with the witness calculator. The pool does not verify an allowance proof.

The malicious-prover run on this tree rejected 63 private mutations of `shielded_transfer`, 103 of `transfer`, 54 of `teleport_out`, and 47 of `allowance_spend`.

Picus calls `circom` with no library flag, so the job links `circuits/circomlib` and `circuits/lib/circomlib` at `node_modules/circomlib` after `npm ci`. Exit 8 is safe and passes. Exit 9 is unsafe and fails the job. Exit 0 is unknown and is not a safety proof. A per-circuit limit of 600 seconds (exit 124) is recorded the same way: the solver stopped, it did not report an under-constrained output. Compile errors and any other exit code fail the job. The log is always uploaded. zkFuzz (`Koukyosyumei/zkFuzz`) has no GitHub release, so it is not pinned. `safe` means Picus did not find an under-constrained output. It is not a completeness proof.

## EVM

Foundry 1.9.0 (tar sha256 `8d17599b42e3139f1a9c171be3798c4ed8e743ae17b84cc3435e57bf2a51ae99`) runs the unit tests and `ShadePoolInvariant.t.sol` (16 runs, depth 4) in the main CI workflow. That invariant checks tracked deposits against the pool balance and checks that the current root is known. Garbage proofs must not move funds.

Slither 0.11.6 with crytic-compile 0.4.2 reads `contracts/evm/slither.config.json`. Generated `Verifier.sol`, `PoseidonT3.sol`, and `PoseidonT7.sol` are filtered. The job fails on a medium or high finding that is not in `detectors_to_exclude`. The excluded detectors, and why they stay excluded:

- `arbitrary-send-eth` and `low-level-calls`: `_pay` sends the proven withdraw amount and relayer fee with a low-level call. The recipient comes from the proof's extDataHash, which also binds the pool address. A pull-payment change would be a different protocol.
- `reentrancy-benign`: `deposit`, `depositToken`, `mintAttested`, and `shieldedTransfer` use a `nonReentrant` lock. `depositToken` still writes the tree after `transferFrom`, because a note must not exist if the token pull fails. The lock is what stops the callback. `testReenteringTokenCannotOpenASecondDeposit` is the regression. Slither does not treat this lock as a guard, so the detector is excluded rather than silenced inside the function.
- `incorrect-equality`: `CryticShade.property_balance` compares the pool balance to tracked deposits. That is the Medusa property. A `selfdestruct` donation can change a native balance. Donated coins do not create a note, and a spend still needs a proof.
- `unused-return`: the Medusa harness ignores the commitment returned by `deposit`. The property checks the balance, not the commitment.
- `naming-convention`: Medusa looks for `property_` prefixes. Those names are not mixedCase.

Aderyn 0.6.8 (tar.xz sha256 `ffd6ca658962e211a3ac821c646f69c8e14bf1b1001cbfe091bcd4535a691e46`) writes SARIF. `scripts/security/aderyn-check.mjs` fails if a rule id is missing from `contracts/evm/aderyn-accept.txt`. Accepted rules:

- `reentrancy-state-change`: same lock and regression test as the Slither note above. `mintAttested` sets the nullifier before `consume`.
- `unsafe-erc20-operation`: `transfer` and `transferFrom` must return `bool`, and the pool checks that bool. A token that returns no value does not match the interface and is not supported.
- `costly-loop` and `literal-instead-of-constant`: the depth-20 frontier stores one node per level, and the domain tags are already named constants where the circuit and the contract share them. The remaining literals are the loop bounds and the zero padding in the extData hash.
- `state-variable-could-be-immutable`: the frontier arrays are filled in the constructor. A storage array cannot be `immutable`.
- `push-zero-opcode` and `unspecific-solidity-pragma`: `foundry.toml` pins solc 0.8.28. The source pragma is `^0.8.24` so the same files compile on that pin. Target testnets are post-Shanghai.
- `contract-locks-ether`, `strict-equality-contract-balance`, `state-change-without-event`, `unused-public-function`: these are on `CryticShade`, the Medusa harness, not on the pool.

Medusa 1.5.1 (tar.gz sha256 `ddfe1517ae9028ef9fc331b00f5a6a9d5406f3fcd11a715d60c6b6fb3e4546d3`) runs `contracts/evm/medusa.json` for 100 transactions or 120 seconds, two workers, sequence length 5. `useSlither` is false. Coverage stays on because 1.5.1 panics in the coverage tracer when coverage is disabled. The property prefix is `property_`. `transactionGasLimit` is 20_000_000 because a depth-20 Poseidon deposit is several million gas. The harness constructor is payable so Medusa can fund it. A local run passed `property_balance`, `property_root_known`, and the deposit assertion (445 calls, 0 failures). The campaign does not fuzz Groth16 witnesses. That is the malicious-prover script.

The SARIF upload step is `continue-on-error` so a repository without code scanning still finishes. The same files are uploaded as the `evm-sarif` artifact.

## Rust

Rust 1.99.1 via `dtolnay/rust-toolchain` commit `683b588c487a69d01f6c6ddf40f036ff682cc2c8`. `cargo clippy --all-targets -- -D warnings` covers `contracts/shade-crypto`, `contracts/near`, and `programs/shade-solana` (feature `insecure-test-setup`). The Solana host build allows `dead_code` on the generated verifying-key module because that module is only used on the Solana target. `ext_data_hash` and the Solana PDA helper allow `too_many_arguments` because the argument list is the circuit preimage. The LiteSVM test helper allows `result_large_err` because the error type is the library's.

cargo-audit 0.22.2 and cargo-deny 0.20.2 read the three `Cargo.lock` files. `deny.toml` allows MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, Unicode-3.0, Zlib, CC0-1.0, Unlicense, and NCSA. NCSA is there because `libfuzzer-sys` is `(MIT OR Apache-2.0) AND NCSA`. The fuzz package is MIT and is its own workspace, so `cargo deny` is also run on `contracts/shade-crypto/fuzz/Cargo.toml`. Licenses, bans, and sources passed. cargo-deny 0.20 has no warn level for unmaintained or unsound crates, so those two checks are `none` and the crates are listed here instead. A new vulnerability that is not ignored still fails.

Ignored vulnerability:

- `RUSTSEC-2025-0055` (`GHSA-xwfj-jgwm-7wp5`), low. `tracing-subscriber` 0.2.25 comes from ark-ff 0.5. The fixed line is 0.3.20, which arkworks 0.5 does not use. This repository does not log user input through that subscriber.

Unmaintained or unsound transitive crates, not fixed in this tree:

- `RUSTSEC-2024-0388` derivative 2.2.0, via arkworks.
- `RUSTSEC-2024-0436` paste 1.0.15, via arkworks and Solana.
- `RUSTSEC-2024-0449` unsafe-libyaml 0.2.11, via near-sdk tests.
- `RUSTSEC-2022-0054` and `GHSA-rc23-xxgq-x27g` wee_alloc 0.4.5. The GitHub advisory is critical. near-sdk 5.11 depends on wee_alloc directly. Removing it means forking the SDK. The NEAR contract stays testnet-only.
- `RUSTSEC-2026-0002`, `RUSTSEC-2026-0253`, and `GHSA-rhfx-m35p-ff5j` lru 0.12.5, via near-sdk. This contract does not call `IterMut` or `pop`.
- `RUSTSEC-2021-0139` ansi_term 0.12.1, `RUSTSEC-2025-0141` bincode 1.3.3, and `RUSTSEC-2025-0161` libsecp256k1 0.7.2, via Solana crates. Proof checks use groth16-solana.

cargo-fuzz 0.13.2 uses nightly `nightly-2026-10-14`. The targets live in `contracts/shade-crypto/fuzz` as their own workspace so `cargo test` does not build them. `parse_field` calls `parse_canonical_field`. `proof_input` calls `screen_proof_json`, which returns an error on bad JSON and on non-canonical field strings instead of panicking. CI runs each target for 20 seconds. A local run finished with no crashes: `parse_field` did 3,425,669 executions and `proof_input` did 1,762,884. The linker is `g++` with `LIBRARY_PATH` pointed at the GCC 13 libstdc++, because `rust-lld` does not find the unversioned `libstdc++.so` on its own.

## JavaScript

`npm audit --audit-level=high` passes. Fourteen moderate findings remain, all dev or client-transitive:

- `GHSA-g3hv-75wg-m249` minimatch, through eslint 10. The non-breaking fix does not clear it. Forcing the fix would downgrade eslint.
- `GHSA-528h-pc64-c93x`, `GHSA-hqr4-qq8f-hg3x`, `GHSA-mjw6-4jj6-33hc` stream-json, and `GHSA-w5hq-g745-h8pq` uuid, through `@solana/web3.js` 1.99. Clearing them means moving to web3.js 3, which is a client migration, not a lockfile bump. The SDK does not call uuid v3, v5, or v6 with a caller-supplied buffer.

Semgrep 1.183.0 runs `.semgrep.yml`. The rules forbid `eval`, `new Function`, `tx.origin`, and `delegatecall`. The run on this tree reported no findings. The registry ruleset `p/javascript` is not the CI gate. It is large and the pinned local rules are the ones that match this repository.

OSV-Scanner 2.7.0 (linux amd64 sha256 `160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b`) scans the npm lockfile and the three Cargo lockfiles. The command passes `--config osv-scanner.toml`. Without that flag, 2.7.0 applies the file only to `package-lock.json` and still reports the Cargo advisories. The ignore list is the ids above, each with a reason. A new id fails the job.

CodeQL for JavaScript and TypeScript uses `github/codeql-action` commit `33d7b85da1a04171e211befe2c739303b9a4c066` (tag v4.39.3, peeled). Dependabot is `.github/dependabot.yml` and opens weekly updates for npm, the three Cargo directories, and GitHub Actions. Dependabot does not scan inside a workflow run.

## Allowance and payroll

`circuits/allowance_spend.circom` checks `amount <= cap`, `amount <= value`, and `now <= expiry` with 64-bit range checks on the differences, so an underflow fails. The TypeScript helper is `src/core/agent/allowance.ts`. `x402Payment` builds the public payment object. It does not call a live x402 endpoint. Tests cover the helper and the witness calculator for an over-cap amount and an expired `now`.

`src/core/payroll/batch.ts` builds one stealth note per payee with `buildOutgoingNote`. `chainHome` is inside the commitment, so a note for one chain does not open on another. The ERC-20 test `testErc20DepositAndWithdrawPaysBothParties` binds a mock token, proves a spend for that token's address, deposits with `depositToken`, and checks that `shieldedTransfer` pays the recipient and the relayer in the token.
