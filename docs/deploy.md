# Shader Protocol testnet deploy

Nothing in this repository has been broadcast. The scripts refuse to send a transaction unless `SHADE_BROADCAST=1` is set in the environment. This checkout does not set that flag. There are no funded keys here.

Mainnet chain ids and the Solana mainnet genesis hash are rejected inside the scripts. A URL is not the check.

## Commands

```bash
node scripts/deploy-robinhood.mjs
node scripts/deploy-elysium.mjs
node scripts/deploy-hyperevm.mjs
node scripts/deploy-base.mjs
sh scripts/deploy-solana.sh
sh scripts/deploy-near.sh
sh scripts/deploy-all-testnets.sh
node scripts/smoke-deployment.mjs --chain evm
node scripts/smoke-deployment.mjs --chain near
```

Without `SHADE_BROADCAST=1` each command prints a refusal and exits. The smoke script does the same: it deposits and then withdraws with a real Groth16 proof only after that flag is set, and only against an empty pool on an allowlisted testnet (or local anvil / NEAR sandbox).

```bash
# EVM. The pool's nextIndex must be 0. The signer pays the deposit and is the relayer.
SHADE_BROADCAST=1 \
  SMOKE_RPC_URL="$ROBINHOOD_RPC_URL" \
  SMOKE_PRIVATE_KEY="$ROBINHOOD_PRIVATE_KEY" \
  SMOKE_POOL=0xPool \
  SMOKE_RECIPIENT=0x000000000000000000000000000000000000bEEF \
  node scripts/smoke-deployment.mjs --chain evm

# NEAR testnet. The contract account's root must still be the empty depth-20 root.
SHADE_BROADCAST=1 \
  NEAR_RPC_URL=https://rpc.testnet.near.org \
  NEAR_ACCOUNT_ID=relayer.testnet \
  NEAR_PRIVATE_KEY=ed25519:... \
  NEAR_CONTRACT_ID=pool.testnet \
  SMOKE_RECIPIENT=recipient.testnet \
  node scripts/smoke-deployment.mjs --chain near
```

The exact deploy commands, still with no broadcast until `SHADE_BROADCAST=1`:

```bash
SHADE_BROADCAST=1 ROBINHOOD_PRIVATE_KEY=... node scripts/deploy-robinhood.mjs
SHADE_BROADCAST=1 ELYSIUM_PRIVATE_KEY=... node scripts/deploy-elysium.mjs
SHADE_BROADCAST=1 HYPEREVM_PRIVATE_KEY=... node scripts/deploy-hyperevm.mjs
SHADE_BROADCAST=1 BASE_PRIVATE_KEY=... node scripts/deploy-base.mjs
SHADE_BROADCAST=1 SOLANA_KEYPAIR=/path/to/devnet-keypair.json sh scripts/deploy-solana.sh
SHADE_BROADCAST=1 NEAR_ACCOUNT_ID=... NEAR_PRIVATE_KEY=... sh scripts/deploy-near.sh
```

`deploy-near.sh` checks `status.chain_id`, builds the wasm, and stops. This repo does not bundle a NEAR deploy CLI, so the wasm is deployed with `near-cli-rs` on testnet. Do not point any of these commands at mainnet. The scripts reject mainnet chain ids and the Solana mainnet genesis hash.

Without `SHADE_BROADCAST=1` each command prints a refusal and exits. With the flag, the EVM scripts read a private key from the environment, ask `cast` for the chain id, and run `forge script`. Solana checks the genesis hash, then `solana program deploy`. NEAR builds the wasm and stops: this repo does not bundle a NEAR deploy CLI, so you finish with `near-cli-rs` on testnet and then edit `website/deployments.json` by hand.

After a successful EVM broadcast, copy the logged `pool` and `verifier` addresses into `website/deployments.json`. The file ships with empty addresses, and the website says "Not deployed yet on this chain" until those fields are filled. Explorer verification is `forge verify-contract` and needs an explorer API key. It is not run automatically.

## Environment

| Variable | Chain |
| --- | --- |
| `ROBINHOOD_PRIVATE_KEY`, `ROBINHOOD_RPC_URL` | Robinhood Chain testnet, chain id 46630. Default RPC `https://rpc.testnet.chain.robinhood.com`. |
| `ELYSIUM_PRIVATE_KEY`, `ELYSIUM_RPC_URL` | Kinetiq Elysium testnet, chain id 99801. Faucet `https://elysium.kinetiq.xyz/testnet-faucet`. |
| `HYPEREVM_PRIVATE_KEY`, `HYPEREVM_RPC_URL` | HyperEVM testnet, chain id 998. RPC `https://rpc.hyperliquid-testnet.xyz/evm`. Drip `https://app.hyperliquid-testnet.xyz/drip`. |
| `BASE_PRIVATE_KEY`, `BASE_RPC_URL` | Base Sepolia, chain id 84532. Faucet `https://www.alchemy.com/faucets/base-sepolia`. |
| `SOLANA_KEYPAIR`, `SOLANA_RPC_URL` | Solana devnet. Faucet `https://faucet.solana.com`. |
| `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`, `NEAR_RPC_URL` | NEAR testnet. Faucet `https://near-faucet.io/`. |
| `SMOKE_RPC_URL`, `SMOKE_PRIVATE_KEY`, `SMOKE_POOL`, `SMOKE_RECIPIENT` | EVM post-deploy smoke. Chain id must be 46630, 99801, 998, 84532, or local anvil 31337. |
| `NEAR_CONTRACT_ID`, `SMOKE_RECIPIENT` | NEAR post-deploy smoke, together with the NEAR account variables. Chain id must be testnet, localnet, or sandbox. |
| `MIN_DEPOSIT` | Optional smallest native deposit, in wei or the chain's smallest unit. Default 1. |
| `SHADE_BROADCAST` | Must be `1` to send a transaction. |

Keys stay in the environment. They are not written into the repo.

Robinhood's public faucet is not recorded here. Use the chain's own testnet docs before you look for one.
