#!/bin/sh
# Runs Picus against each circuit. PICUS_HOME is the Veridise/Picus checkout.
# A non-zero status is recorded and does not stop the remaining circuits.
set -u
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
picus_home=${PICUS_HOME:?PICUS_HOME must point at the Picus checkout}
log=${PICUS_LOG:-$root/picus.log}
: > "$log"
status=0
for circuit in circuits/shielded_transfer.circom circuits/transfer.circom circuits/teleport_out.circom circuits/allowance_spend.circom; do
  echo "=== $circuit ===" | tee -a "$log"
  if ! (cd "$picus_home" && ./run-picus --solver z3 --timeout 5000 "$root/$circuit") >> "$log" 2>&1; then
    echo "picus failed on $circuit" | tee -a "$log"
    status=1
  fi
done
exit "$status"
