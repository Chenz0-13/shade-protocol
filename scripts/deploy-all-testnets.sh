#!/bin/sh
# Plans every testnet deploy and refuses to broadcast unless SHADE_BROADCAST=1.
# This environment has no funded keys. Do not export that flag here.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
echo "Shade testnet deploy plan. Broadcasting only when SHADE_BROADCAST=1."
for script in \
  scripts/deploy-robinhood.mjs \
  scripts/deploy-elysium.mjs \
  scripts/deploy-hyperevm.mjs \
  scripts/deploy-base.mjs
 do
  echo "== $script =="
  node "$script"
done
echo "== scripts/deploy-solana.sh =="
sh scripts/deploy-solana.sh
echo "== scripts/deploy-near.sh =="
sh scripts/deploy-near.sh
echo "No transaction was sent unless SHADE_BROADCAST=1 was set before this script."
