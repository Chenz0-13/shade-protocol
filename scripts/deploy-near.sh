#!/bin/sh
set -eu
url="${NEAR_RPC_URL:-https://rpc.testnet.near.org}"
case "$url" in
  *mainnet*) echo "Refusing NEAR mainnet." >&2; exit 1 ;;
esac
if [ -z "${NEAR_ACCOUNT_ID:-}" ] || [ -z "${NEAR_PRIVATE_KEY:-}" ]; then
  echo "Set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY. Refusing to deploy without a key." >&2
  exit 1
fi
cargo build --release --target wasm32-unknown-unknown --manifest-path "$(dirname "$0")/../contracts/near/Cargo.toml"
echo "Wasm: contracts/near/target/wasm32-unknown-unknown/release/shade_near.wasm"
echo "Deploy that wasm to $NEAR_ACCOUNT_ID on $url with near-cli-rs."
echo "This environment does not bundle a NEAR deploy CLI, so the script stops after the build."
exit 2
