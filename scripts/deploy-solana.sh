#!/bin/sh
set -eu
url="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
genesis="$(solana genesis-hash --url "$url")"
case "$genesis" in
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG|4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY) ;;
  5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d)
    echo "Refusing Solana mainnet genesis hash." >&2
    exit 1
    ;;
  *)
    echo "Refusing Solana genesis hash $genesis. Devnet and testnet only." >&2
    exit 1
    ;;
esac
if [ -z "${SOLANA_KEYPAIR:-}" ]; then
  echo "Set SOLANA_KEYPAIR to a devnet keypair file. Refusing to deploy without a key." >&2
  exit 1
fi
cd "$(dirname "$0")/../programs/shade-solana"
cargo-build-sbf --features insecure-test-setup
solana program deploy target/deploy/shade_solana.so --url "$url" --keypair "$SOLANA_KEYPAIR"
echo "Deployed the Shade pool (frontier tree, nullifier PDAs, SOL vault)."
echo "Set SHADE_SOLANA_PROGRAM_ID to the program id printed above."
echo "This binary embeds the single-party Groth16 setup. Do not point it at mainnet."
