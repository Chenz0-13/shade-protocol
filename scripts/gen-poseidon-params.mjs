/**
 * Writes the circomlib Poseidon parameter blobs used by the EVM library and
 * the NEAR hasher, plus shared test vectors from poseidon-lite.
 *
 * Widths are the ones the pool and the circuit use:
 *   2 inputs (t = 3) Merkle nodes
 *   3 inputs (t = 4) nullifiers
 *   6 inputs (t = 7) commitments and extDataHash
 *
 * Run from the repo root: node scripts/gen-poseidon-params.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { poseidon2, poseidon3, poseidon6 } from "poseidon-lite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const F = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const N_ROUNDS_F = 8;
const N_ROUNDS_P = [56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68];
const HASHERS = { 2: poseidon2, 3: poseidon3, 6: poseidon6 };

function load(inputs) {
  const file = path.join(root, "node_modules", "poseidon-lite", "constants", `${inputs}.js`);
  const raw = require(file).default;
  const decode = (b64) => {
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length !== 32) throw new Error(`constant is ${bytes.length} bytes`);
    const value = BigInt(`0x${bytes.toString("hex")}`);
    if (value >= F) throw new Error("constant is not reduced");
    return bytes;
  };
  const C = raw.C.map(decode);
  const M = raw.M.map((row) => row.map(decode));
  const t = inputs + 1;
  const rounds = N_ROUNDS_F + N_ROUNDS_P[t - 2];
  if (M.length !== t || M.some((row) => row.length !== t)) throw new Error(`bad MDS for ${inputs}`);
  if (C.length !== rounds * t) throw new Error(`bad round constants for ${inputs}: ${C.length}`);
  return { C, M, t, rounds };
}

function reference(inputs, table) {
  const values = table.C.map((bytes) => BigInt(`0x${bytes.toString("hex")}`));
  const matrix = table.M.map((row) => row.map((bytes) => BigInt(`0x${bytes.toString("hex")}`)));
  const t = table.t;
  let state = [0n, ...inputs];
  for (let round = 0; round < table.rounds; round++) {
    const full = round < N_ROUNDS_F / 2 || round >= N_ROUNDS_F / 2 + N_ROUNDS_P[t - 2];
    for (let i = 0; i < t; i++) {
      state[i] = (state[i] + values[round * t + i]) % F;
      if (full || i === 0) {
        const square = state[i] * state[i];
        state[i] = (state[i] * square * square) % F;
      }
    }
    const mixed = [];
    for (let row = 0; row < t; row++) {
      let acc = 0n;
      for (let col = 0; col < t; col++) acc += matrix[row][col] * state[col];
      mixed.push(acc % F);
    }
    state = mixed;
  }
  return state[0];
}

function blob(table) {
  return Buffer.concat([...table.M.flat(), ...table.C]);
}

const FIELD_MINUS_ONE = F - 1n;
const patterns = {
  2: [
    [0n, 0n],
    [1n, 2n],
    [FIELD_MINUS_ONE, 2n],
  ],
  3: [
    [0n, 0n, 0n],
    [1n, 2n, 3n],
    [FIELD_MINUS_ONE, 1n, 2n],
  ],
  6: [
    [0n, 0n, 0n, 0n, 0n, 0n],
    [1n, 2n, 3n, 4n, 5n, 6n],
    [1n, 1000n, 7n, 9n, FIELD_MINUS_ONE, 1n],
  ],
};

const paramDir = path.join(root, "contracts", "shade-crypto", "src", "params");
mkdirSync(paramDir, { recursive: true });
const cases = [];
for (const inputs of [2, 3, 6]) {
  const table = load(inputs);
  const bytes = blob(table);
  const expected = (table.t * table.t + table.rounds * table.t) * 32;
  if (bytes.length !== expected) throw new Error(`blob length ${bytes.length} != ${expected}`);
  writeFileSync(path.join(paramDir, `circom_${inputs}.bin`), bytes);
  for (const pattern of patterns[inputs]) {
    const fromLite = HASHERS[inputs](pattern);
    const fromTable = reference(pattern, table);
    if (fromLite !== fromTable) {
      throw new Error(`poseidon-lite mismatch for ${pattern.join(",")}`);
    }
    cases.push({
      inputs: pattern.map((value) => value.toString()),
      hash: fromLite.toString(),
    });
  }
  process.stdout.write(`width ${inputs}: ${bytes.length} bytes, ${table.rounds} rounds\n`);
}

const vectorPath = path.join(root, "contracts", "shade-crypto", "testdata", "poseidon-vectors.json");
mkdirSync(path.dirname(vectorPath), { recursive: true });
writeFileSync(
  vectorPath,
  `${JSON.stringify(
    {
      source: "poseidon-lite 0.3.0 circomlib BN254 x^5. Widths 2, 3, and 6.",
      count: cases.length,
      cases,
    },
    null,
    2,
  )}\n`,
);

const solidity = path.join(root, "contracts", "evm", "src", "PoseidonT7.sol");
const source = readFileSync(solidity, "utf8");
const hex = blob(load(6)).toString("hex");
const next = source.replace(
  /\/\/ PARAMS-BEGIN\n[\s\S]*?\/\/ PARAMS-END/,
  `// PARAMS-BEGIN\n    bytes internal constant PARAMS = hex"${hex}";\n    // PARAMS-END`,
);
if (next === source || !next.includes(hex.slice(0, 32))) {
  throw new Error("PoseidonT7.sol is missing the PARAMS markers");
}
writeFileSync(solidity, next);
process.stdout.write(`wrote ${cases.length} vectors and PoseidonT7 constants\n`);
