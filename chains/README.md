# Chains

Chain code lives in `src/core/chain`, not in this directory.

Solana devnet submission calls the Shade pool program. NEAR testnet signs a
function call. Robinhood Chain testnet (chain id 46630) and Kinetiq Elysium
testnet (chain id 99801) call the EVM ShadePool. Canton throws
`NotImplementedError` because the Daml contracts record attestor signatures,
not proofs.

Mainnet is refused by chain id or genesis hash. A URL that contains the word
mainnet is not itself the check, and a URL that does not contain that word
is not itself permission to deploy.
