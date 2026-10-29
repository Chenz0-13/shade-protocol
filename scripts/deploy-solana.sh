#!/bin/sh
set -eu
url="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
case "$url" in
  *mainnet*) echo "Refusing Solana mainnet." >&2; exit 1 ;;
esac
if [ -z "${SOLANA_KEYPAIR:-}" ]; then
  echo "Set SOLANA_KEYPAIR to a devnet keypair file. Refusing to deploy without a key." >&2
  exit 1
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/../programs/shade-solana"
cargo-build-sbf --features insecure-test-setup
solana program deploy target/deploy/shade_solana.so --url "$url" --keypair "$SOLANA_KEYPAIR"
echo "This binary embeds the single-party Groth16 setup. Do not point it at mainnet."
