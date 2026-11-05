import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lite = path.join(root, "node_modules", "poseidon-lite");
const unstringify = require(path.join(lite, "poseidon", "unstringify.js")).default;
const poseidon = require(path.join(lite, "poseidon", "index.js"));
const hash2 = (a, b) => poseidon([a, b], unstringify(require(path.join(lite, "constants", "2.js")).default));
const hash3 = (xs) => poseidon(xs, unstringify(require(path.join(lite, "constants", "3.js")).default));
const hash4 = (xs) => poseidon(xs, unstringify(require(path.join(lite, "constants", "4.js")).default));
const hash6 = (xs) => poseidon(xs, unstringify(require(path.join(lite, "constants", "6.js")).default));

const DEPTH = 20;
const zeros = [0n];
for (let level = 0; level < DEPTH; level += 1) zeros.push(hash2(zeros[level], zeros[level]));

function tree() {
  const layers = [[]];
  return {
    insert(leaf) {
      const index = layers[0].length;
      layers[0][index] = leaf;
      let current = leaf;
      let cursor = index;
      for (let level = 0; level < DEPTH; level += 1) {
        if (!layers[level + 1]) layers[level + 1] = [];
        const right = cursor % 2 === 1;
        const sibling = layers[level][right ? cursor - 1 : cursor + 1] ?? zeros[level];
        current = right ? hash2(sibling, current) : hash2(current, sibling);
        cursor = Math.floor(cursor / 2);
        layers[level + 1][cursor] = current;
      }
      return index;
    },
    path(index) {
      const pathElements = [];
      const pathIndices = [];
      let cursor = index;
      for (let level = 0; level < DEPTH; level += 1) {
        const right = cursor % 2 === 1;
        pathElements.push((layers[level][right ? cursor - 1 : cursor + 1] ?? zeros[level]).toString());
        pathIndices.push(right ? "1" : "0");
        cursor = Math.floor(cursor / 2);
      }
      return { pathElements, pathIndices, root: layers[DEPTH][0].toString() };
    },
  };
}

function tag(asset, chain) {
  return hash2(hash2(7n, asset), hash2(9n, chain));
}
function s(value) {
  return value.toString();
}

function shielded() {
  const notes = tree();
  const asset = 1n;
  const chain = 46630n;
  const packed = tag(asset, chain);
  const owner = hash2(3n, 17n);
  const commitment = hash6([1n, 1000n, 11n, 13n, owner, packed]);
  const index = notes.insert(commitment);
  const membership = notes.path(index);
  let leaf = 0n;
  let pow = 1n;
  for (const bit of membership.pathIndices) {
    leaf += BigInt(bit) * pow;
    pow *= 2n;
  }
  const nullifier = hash4([2n, 17n, commitment, leaf]);
  const rho1 = hash3([6n, nullifier, 1n]);
  const rho2 = hash3([6n, nullifier, 2n]);
  const out1 = hash6([1n, 0n, 19n, rho1, owner, packed]);
  const out2 = hash6([1n, 0n, 29n, rho2, owner, packed]);
  const binder = hash6([5n, 1n, 2n, 46630n, 600n, 400n]);
  const ext = hash6([3n, 4n, 5n, 6n, binder, 0n]);
  return {
    public: ["merkleRoot", "nullifierHash", "commitmentOut1", "commitmentOut2", "withdrawAmount", "relayerFee", "extDataHash"],
    witness: {
      merkleRoot: membership.root,
      nullifierHash: s(nullifier),
      commitmentOut1: s(out1),
      commitmentOut2: s(out2),
      withdrawAmount: "600",
      relayerFee: "400",
      extDataHash: s(ext),
      recipientLo: "3",
      recipientHi: "4",
      relayerLo: "5",
      relayerHi: "6",
      poolLo: "1",
      poolHi: "2",
      chainDomain: "46630",
      valueIn: "1000",
      blindingIn: "11",
      rhoIn: "13",
      assetIn: "1",
      chainHome: "46630",
      spendingKey: "17",
      pathElements: membership.pathElements,
      pathIndices: membership.pathIndices,
      valueOut1: "0",
      blindingOut1: "19",
      rhoOut1: s(rho1),
      ownerOut1: s(owner),
      assetOut1: "1",
      valueOut2: "0",
      blindingOut2: "29",
      rhoOut2: s(rho2),
      ownerOut2: s(owner),
      assetOut2: "1",
    },
  };
}

function transfer() {
  const notes = tree();
  const packed = tag(1n, 46630n);
  const owner0 = hash2(3n, 17n);
  const owner1 = hash2(3n, 19n);
  const in0 = hash6([1n, 60n, 11n, 13n, owner0, packed]);
  const in1 = hash6([1n, 40n, 23n, 29n, owner1, packed]);
  const i0 = notes.insert(in0);
  const i1 = notes.insert(in1);
  const p0 = notes.path(i0);
  const p1 = notes.path(i1);
  const leaf = (bits) => bits.reduce((acc, bit, level) => acc + BigInt(bit) * 2n ** BigInt(level), 0n);
  const n0 = hash4([2n, 17n, in0, leaf(p0.pathIndices)]);
  const n1 = hash4([2n, 19n, in1, leaf(p1.pathIndices)]);
  const rho0 = hash3([6n, n0, 1n]);
  const rho1 = hash3([6n, n1, 1n]);
  const out0 = hash6([1n, 70n, 31n, rho0, owner0, packed]);
  const out1 = hash6([1n, 30n, 37n, rho1, owner1, packed]);
  const binder = hash6([5n, 1n, 2n, 46630n, 0n, 0n]);
  const ext = hash6([3n, 4n, 5n, 6n, binder, 0n]);
  return {
    public: ["merkleRoot", "nullifier0", "nullifier1", "commitmentOut0", "commitmentOut1", "extDataHash"],
    witness: {
      merkleRoot: p0.root,
      nullifier0: s(n0),
      nullifier1: s(n1),
      commitmentOut0: s(out0),
      commitmentOut1: s(out1),
      extDataHash: s(ext),
      valueIn0: "60",
      blindingIn0: "11",
      rhoIn0: "13",
      valueIn1: "40",
      blindingIn1: "23",
      rhoIn1: "29",
      assetId: "1",
      chainHome: "46630",
      spendingKey0: "17",
      spendingKey1: "19",
      pathElements0: p0.pathElements,
      pathIndices0: p0.pathIndices,
      pathElements1: p1.pathElements,
      pathIndices1: p1.pathIndices,
      valueOut0: "70",
      blindingOut0: "31",
      ownerOut0: s(owner0),
      valueOut1: "30",
      blindingOut1: "37",
      ownerOut1: s(owner1),
      recipientLo: "3",
      recipientHi: "4",
      relayerLo: "5",
      relayerHi: "6",
      poolLo: "1",
      poolHi: "2",
      chainDomain: "46630",
    },
  };
}

function teleport() {
  const notes = tree();
  const owner = hash2(3n, 17n);
  const commitment = hash6([1n, 1000n, 11n, 13n, owner, tag(1n, 46630n)]);
  const index = notes.insert(commitment);
  const membership = notes.path(index);
  const leaf = membership.pathIndices.reduce((acc, bit, level) => acc + BigInt(bit) * 2n ** BigInt(level), 0n);
  const nullifier = hash4([2n, 17n, commitment, leaf]);
  const rho = hash3([6n, nullifier, 1n]);
  const out = hash6([1n, 600n, 19n, rho, owner, tag(1n, 99801n)]);
  const binder = hash6([5n, 1n, 2n, 46630n, 600n, 400n]);
  const ext = hash6([3n, 4n, 5n, 6n, binder, 99801n]);
  return {
    public: ["merkleRoot", "nullifierHash", "commitmentOut", "destChain", "amount", "relayerFee", "extDataHash"],
    witness: {
      merkleRoot: membership.root,
      nullifierHash: s(nullifier),
      commitmentOut: s(out),
      destChain: "99801",
      amount: "600",
      relayerFee: "400",
      extDataHash: s(ext),
      valueIn: "1000",
      blindingIn: "11",
      rhoIn: "13",
      assetId: "1",
      chainHome: "46630",
      spendingKey: "17",
      pathElements: membership.pathElements,
      pathIndices: membership.pathIndices,
      blindingOut: "19",
      ownerOut: s(owner),
      recipientLo: "3",
      recipientHi: "4",
      relayerLo: "5",
      relayerHi: "6",
      poolLo: "1",
      poolHi: "2",
    },
  };
}

function allowance() {
  const notes = tree();
  const owner = hash2(3n, 17n);
  const policy = hash3([10n, 40n, 1000n]);
  const packed = hash2(tag(1n, 46630n), policy);
  const commitment = hash6([1n, 100n, 11n, 13n, owner, packed]);
  const index = notes.insert(commitment);
  const membership = notes.path(index);
  const leaf = membership.pathIndices.reduce((acc, bit, level) => acc + BigInt(bit) * 2n ** BigInt(level), 0n);
  const nullifier = hash4([2n, 17n, commitment, leaf]);
  return {
    public: ["merkleRoot", "nullifierHash", "amount", "now", "expiry"],
    witness: {
      merkleRoot: membership.root,
      nullifierHash: s(nullifier),
      amount: "25",
      now: "500",
      expiry: "1000",
      value: "100",
      cap: "40",
      blinding: "11",
      rho: "13",
      assetId: "1",
      chainHome: "46630",
      spendingKey: "17",
      pathElements: membership.pathElements,
      pathIndices: membership.pathIndices,
    },
  };
}

function compile(name) {
  const dir = mkdtempSync(path.join(tmpdir(), "shade-wasm-"));
  const compiled = spawnSync("circom", [`circuits/${name}.circom`, "--wasm", "-l", "node_modules", "-o", dir], {
    cwd: root,
    encoding: "utf8",
  });
  if (compiled.status !== 0) throw new Error(compiled.stderr || compiled.stdout || name);
  return path.join(dir, `${name}_js`, `${name}.wasm`);
}

function accepts(wasm, witness) {
  const dir = mkdtempSync(path.join(tmpdir(), "shade-wtns-"));
  const input = path.join(dir, "input.json");
  writeFileSync(input, JSON.stringify(witness));
  const result = spawnSync(
    process.execPath,
    ["node_modules/snarkjs/build/cli.cjs", "wtns", "calculate", wasm, input, path.join(dir, "out.wtns")],
    { cwd: root, encoding: "utf8" },
  );
  return result.status === 0;
}

function mutate(witness, key, index) {
  const copy = { ...witness, ...(Array.isArray(witness[key]) ? { [key]: [...witness[key]] } : {}) };
  if (index === null) copy[key] = (BigInt(copy[key]) + 1n).toString();
  else copy[key][index] = (BigInt(copy[key][index]) + 1n).toString();
  return copy;
}

const cases = [
  ["shielded_transfer", shielded],
  ["transfer", transfer],
  ["teleport_out", teleport],
  ["allowance_spend", allowance],
];

for (const [name, build] of cases) {
  const { public: pub, witness } = build();
  const wasm = compile(name);
  if (!accepts(wasm, witness)) throw new Error(`${name} honest witness was rejected`);
  let checked = 0;
  for (const [key, value] of Object.entries(witness)) {
    if (pub.includes(key)) continue;
    const slots = Array.isArray(value) ? value.length : 1;
    for (let index = 0; index < slots; index += 1) {
      if (accepts(wasm, mutate(witness, key, Array.isArray(value) ? index : null))) {
        throw new Error(`${name} accepted a mutated ${key}${Array.isArray(value) ? `[${index}]` : ""}`);
      }
      checked += 1;
    }
  }
  process.stdout.write(`${name}: ${checked} mutated private signals rejected\n`);
}
