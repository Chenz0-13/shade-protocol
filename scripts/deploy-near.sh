#!/bin/sh
set -eu
if [ "${SHADE_BROADCAST:-}" != "1" ]; then
  echo "Refusing to broadcast. Set SHADE_BROADCAST=1 after reading docs/deploy.md. No transaction was sent." >&2
  exit 0
fi
url="${NEAR_RPC_URL:-https://rpc.testnet.near.org}"
status="$(curl -fsS "$url" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"shade","method":"status","params":[]}')"
chain="$(printf '%s' "$status" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const id=JSON.parse(s).result&&JSON.parse(s).result.chain_id; if(!id){process.stderr.write("NEAR status did not include a chain id\n"); process.exit(1)} process.stdout.write(id)})')"
case "$chain" in
  testnet|localnet|sandbox) ;;
  mainnet)
    echo "Refusing NEAR mainnet chain id." >&2
    exit 1
    ;;
  *)
    echo "Refusing NEAR chain id $chain." >&2
    exit 1
    ;;
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
