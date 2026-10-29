# Infrastructure

Deployment manifests are not part of this repository. Runtime configuration
is environment variables, validated by `resolveConfig` in
`src/core/chain/config.ts`, and it defaults to devnet and testnet.
