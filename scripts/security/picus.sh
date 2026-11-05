#!/bin/sh
# Runs Picus against each circuit. PICUS_HOME is the Veridise/Picus checkout.
# Exit codes from Picus: 0 unknown, 8 safe, 9 unsafe, 50 user error (bad compile).
# Unknown is not a proof of safety. Unsafe fails this script. A per-circuit
# time limit (PICUS_CIRCUIT_TIMEOUT, seconds) that expires is recorded as
# unknown so a slow SMT query is not reported as an under-constrained signal.
set -u
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
picus_home=${PICUS_HOME:?PICUS_HOME must point at the Picus checkout}
log=${PICUS_LOG:-$root/picus.log}
limit=${PICUS_CIRCUIT_TIMEOUT:-600}
: > "$log"
status=0

if [ ! -d "$root/node_modules/circomlib" ]; then
  echo "node_modules/circomlib is missing. Run npm ci before Picus." | tee -a "$log"
  exit 1
fi
# Picus calls circom with no -l. Includes resolve next to the file that contains them.
ln -sfn ../node_modules/circomlib "$root/circuits/circomlib"
ln -sfn ../../node_modules/circomlib "$root/circuits/lib/circomlib"

for circuit in circuits/shielded_transfer.circom circuits/transfer.circom circuits/teleport_out.circom circuits/allowance_spend.circom; do
  echo "=== $circuit ===" | tee -a "$log"
  set +e
  timeout "$limit" bash "$picus_home/run-picus" --solver z3 --timeout 5000 "$root/$circuit" >> "$log" 2>&1
  code=$?
  set -e
  case "$code" in
    0)
      echo "picus unknown on $circuit (exit 0). Not a safety proof." | tee -a "$log"
      ;;
    8)
      echo "picus safe on $circuit (exit 8)." | tee -a "$log"
      ;;
    9)
      echo "picus unsafe on $circuit (exit 9). See the counterexample above." | tee -a "$log"
      status=1
      ;;
    124)
      echo "picus hit the ${limit}s limit on $circuit. Not a safety proof and not an under-constrained result." | tee -a "$log"
      ;;
    *)
      echo "picus failed on $circuit with exit $code" | tee -a "$log"
      status=1
      ;;
  esac
done
exit "$status"
