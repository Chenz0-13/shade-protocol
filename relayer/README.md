# Shader relayer

Testnet only. This service submits a shielded withdrawal or private send so the user does not pay gas from their own wallet. The fee comes out of the shielded amount. The pool already pays that fee to the relayer address bound in the proof. No contract change and no new proving keys are required.

Robinhood Chain testnet (46630) and Elysium testnet (99801) are on. HyperEVM testnet (998) and Base Sepolia (84532) are listed but turned off until a pool is deployed. Mainnet is refused.

## What you need to host it

A small container or VM is enough. It keeps request status in memory, so a restart forgets in-flight jobs. The chain still rejects a spent note. Give it:

- a funded testnet key in `RELAYER_PRIVATE_KEY` (faucet coins on Robinhood and Elysium)
- the pinned `verification_key.json` from the `circuits-pinned-v1` release, mounted at `RELAYER_VKEY`
- outbound HTTPS to the two testnet RPCs
- a public HTTPS URL if the website should call it

Do not point it at mainnet, and do not put the key in the repo.

## Run it

```bash
cp relayer/.env.example .env
# fill in RELAYER_PRIVATE_KEY and download verification_key.json
set -a
source .env
set +a
npm ci
npm run build
npm run relayer
```

The program reads the variables from the environment. It does not open `.env` itself.

The process listens on port 8787.

```bash
docker build -f relayer/Dockerfile -t shader-relayer .
docker run --rm -p 8787:8787 --env-file .env -v "$PWD/verification_key.json:/vkey.json:ro" -e RELAYER_VKEY=/vkey.json shader-relayer
```

In the app, turn on **Use relayer (recommended)**, paste this service's URL, and the fee quote appears before a private send or withdrawal. Leave the toggle off to submit from the connected wallet as before. You can also bake the URL in with `VITE_RELAYER_URL` when building the app.

## API

- `GET /v1/info` returns the relayer address, the fee quote, and which chains are accepting.
- `POST /v1/relay` takes `{ chainId, recipient, proof, publicSignals }`. The proof must bind this relayer and a fee at least as large as the quote.
- `GET /v1/status/:id` returns `submitted`, `confirmed`, or `failed`.

The service checks the proof with the pinned verification key, simulates the pool call, and refuses when gas is above the fee or the gas-price cap. It limits body size and how many relays it accepts per minute. It does not log note secrets, proofs, or IP addresses.
