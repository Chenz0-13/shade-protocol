# Chains

Chain code lives in `src/core/chain`, not in this directory.

Solana devnet submission signs a Memo transaction with the public proof
inputs. NEAR, Canton, and Robinhood throw `NotImplementedError`. Mainnet
endpoints are rejected.
