# Groth16 ceremony tooling

The circuits are not frozen. No ceremony has been started. The keys produced by `npm run circuit:setup` are a single-party development setup. Do not deploy them.

This directory of scripts is the tooling a later ceremony would use. Running it does not make the result a ceremony.

## What has to be true first

1. The circuit source is frozen. A change after the first contribution throws the ceremony away.
2. The Powers of Tau file is large enough. The pinned Hermez file is `powersOfTau28_hez_final_16.ptau` (2^16 constraints). The current largest circuit, `transfer.circom`, is under that cap. If a later circuit grows past it, start over with a larger file.
3. At least one contributor is honest and destroys their entropy. The result is safe if one contributor is honest. It is not safe if every contributor colludes or leaks entropy.

## How a contribution works

Phase 1 is the public Perpetual Powers of Tau response from Hermez. `scripts/ceremony/init.mjs` downloads that file and checks the blake2b512 hash pinned in `scripts/ceremony/ptau-pin.json`.

Phase 2 is a chain of `snarkjs zkey contribute` steps. Each contributor takes the previous `.zkey`, adds entropy, and publishes the new file. `scripts/ceremony/verify-chain.mjs` runs `snarkjs zkey verify` on every file in the chain.

The last step is a beacon. `scripts/ceremony/beacon.mjs` reads the latest drand randomness from `https://drand.cloudflare.com/public/latest`, or a hash you pass with `--beacon` (for example a future block hash that did not exist when the last contribution was made). The beacon stops the last contributor from grinding the result.

`scripts/ceremony/export.mjs` writes the verification key, a Solidity verifier, and the sha256 of both. `scripts/ceremony/check-vkey.mjs` fails CI when `contracts/evm/src/Verifier.sol` constants do not match `circuits/build/verification_key.json`. snarkjs swaps the Fq2 limbs when it exports Solidity, and the check uses that order. A published hash file, if one exists under `circuits/ceremony/published/`, is compared too. Nothing is published yet.

The scripts refuse to run unless `SHADE_CEREMONY_ACK=circuits-not-frozen` is set. That flag means you are exercising the tooling. It does not mean a ceremony is open.

## Contributor guide

### CLI

```bash
npm install
export SHADE_CEREMONY_ACK=circuits-not-frozen
node scripts/ceremony/init.mjs
# compile the frozen circuit to circuits/ceremony/r1cs/<name>.r1cs with circom --r1cs --O0
node scripts/ceremony/contribute.mjs --circuit shielded_transfer --name "Your Name" --entropy "$(head -c 64 /dev/urandom | xxd -p)"
node scripts/ceremony/verify-chain.mjs --circuit shielded_transfer
```

Keep the entropy off the command line on a shared machine if you can. The script passes it to snarkjs because that is the CLI the tool supports. Delete the shell history afterwards. Do not reuse the entropy.

### Browser

Open `website/ceremony.html`. The page is labelled "Ceremony not started" and does not accept a contribution. When a ceremony is actually open, the same page loads snarkjs in the browser and talks to a coordinator.

## Coordinator API

The browser page expects this HTTP API. No server in this repository implements it. A later coordinator can be a small service in front of a GitHub-authenticated queue.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/ceremony/status` | | `{ "started": false, "circuit": null, "latest": null }` until the ceremony opens |
| POST | `/api/ceremony/queue` | GitHub OAuth bearer token | `{ "position": number }` |
| GET | `/api/ceremony/challenge` | `Authorization: Bearer` | The current `.zkey` bytes, or 409 if it is not your turn |
| POST | `/api/ceremony/contribution` | multipart file plus the contributor name | 202 after `zkey verify` succeeds |

Rules for that service:

- One contribution at a time. The next person waits.
- Verify the uploaded zkey before it becomes the new challenge.
- Store the transcript (name, hash of the previous file, hash of the new file) in public.
- Reject uploads after the circuit hash changes.

## Threat model

Safe if one honest contributor deletes their entropy and the beacon is unpredictable at the time of the last human contribution. Not safe if the circuit changes afterwards, if the Powers of Tau file is the wrong one, or if every contributor is dishonest. The development setup used in CI meets none of those conditions.
