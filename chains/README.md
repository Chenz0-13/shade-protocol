# Chains

Chain code lives in `src/core/chain`, not in this directory.

Solana devnet submission calls the Shade pool program. NEAR testnet signs a
function call. Robinhood Chain testnet (chain id 46630), Kinetiq Elysium
testnet (chain id 99801), HyperEVM testnet (chain id 998), and Base Sepolia
(chain id 84532) call the EVM ShadePool. Canton throws `NotImplementedError`
because the Daml contracts record attestor signatures, not proofs.

Mainnet is refused by chain id or genesis hash. A URL that contains the word
mainnet is not itself the check, and a URL that does not contain that word
is not itself permission to deploy.

Those EVM testnets enforce EIP-170 (24576-byte runtime) and EIP-3860
(49152-byte initcode). `PoseidonT3` and `PoseidonT7` store the circomlib
matrix and round constants once and hash in a loop so the deployed contracts
stay under both limits. NEAR testnet rejects transaction payloads around
1.5 MiB. The NEAR wasm ships Poseidon parameters only for 2, 3, 4, and 6
inputs. The hash is still circomlib Poseidon.
