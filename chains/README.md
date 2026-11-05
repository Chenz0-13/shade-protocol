# Chains

Chain code lives in `src/core/chain`, not in this directory.

Solana devnet submission signs a Memo transaction with the public proof
inputs. NEAR, Canton, and Robinhood throw `NotImplementedError`. Mainnet
endpoints are rejected.

Robinhood Chain testnet (chain id 46630) caps deployed contract code at
98304 bytes. NEAR testnet rejects transaction payloads around 1.5 MiB.
`PoseidonT7` and the NEAR Poseidon tables are sized for those limits and
still use the circomlib hash.
