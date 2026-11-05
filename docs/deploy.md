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
```

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
| `MIN_DEPOSIT` | Optional smallest native deposit, in wei or the chain's smallest unit. Default 1. |
| `SHADE_BROADCAST` | Must be `1` to send a transaction. |

Keys stay in the environment. They are not written into the repo.

Robinhood's public faucet is not recorded here. Use the chain's own testnet docs before you look for one.
