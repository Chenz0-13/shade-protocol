import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lite = path.join(root, "node_modules", "poseidon-lite");
const unstringify = require(path.join(lite, "poseidon", "unstringify.js")).default;
const poseidon = require(path.join(lite, "poseidon", "index.js"));
const c2 = unstringify(require(path.join(lite, "constants", "2.js")).default);
const c6 = unstringify(require(path.join(lite, "constants", "6.js")).default);
const hash2 = (a, b) => poseidon([a, b], c2);
const hash6 = (xs) => poseidon(xs, c6);

const DEPTH = 8;
const zeros = [0n];
for (let level = 0; level < DEPTH; level += 1) zeros.push(hash2(zeros[level], zeros[level]));

const layers = [[]];
function insert(leaf) {
  const index = layers[0].length;
  layers[0][index] = leaf;
  let current = leaf;
  let cursor = index;
  for (let level = 0; level < DEPTH; level += 1) {
    if (!layers[level + 1]) layers[level + 1] = [];
    const isRight = cursor % 2 === 1;
    const siblingIndex = isRight ? cursor - 1 : cursor + 1;
    const sibling = layers[level][siblingIndex] ?? zeros[level];
    const left = isRight ? sibling : current;
    const right = isRight ? current : sibling;
    current = hash2(left, right);
    cursor = Math.floor(cursor / 2);
    layers[level + 1][cursor] = current;
  }
  return index;
}

function proof(index) {
  const pathElements = [];
  const pathIndices = [];
  let cursor = index;
  for (let level = 0; level < DEPTH; level += 1) {
    const isRight = cursor % 2 === 1;
    const siblingIndex = isRight ? cursor - 1 : cursor + 1;
    pathElements.push(layers[level][siblingIndex] ?? zeros[level]);
    pathIndices.push(isRight ? 1 : 0);
    cursor = Math.floor(cursor / 2);
  }
  return { pathElements, pathIndices, root: layers[DEPTH][0] };
}

const value = 1000n;
const blinding = 11n;
const rho = 13n;
const spendingKey = 17n;
const owner = hash2(3n, spendingKey);
const asset = 1n;
const commitment = hash6([1n, value, blinding, rho, owner, asset]);
const index = insert(commitment);
const membership = proof(index);
const nullifier = poseidon([2n, spendingKey, rho], unstringify(require(path.join(lite, "constants", "3.js")).default));

const out1 = { value: 0n, blinding: 19n, rho: 23n, owner, asset };
const out2 = { value: 0n, blinding: 29n, rho: 31n, owner, asset };
const fee = value;
const external = externalData(process.argv.slice(2), fee);
const extHash = hash6([
  external.recipientLo,
  external.recipientHi,
  external.relayerLo,
  external.relayerHi,
  fee,
  external.domain,
]);
const commitmentOut1 = hash6([1n, out1.value, out1.blinding, out1.rho, out1.owner, out1.asset]);
const commitmentOut2 = hash6([1n, out2.value, out2.blinding, out2.rho, out2.owner, out2.asset]);

const witness = {
  merkleRoot: membership.root.toString(),
  nullifierHash: nullifier.toString(),
  commitmentOut1: commitmentOut1.toString(),
  commitmentOut2: commitmentOut2.toString(),
  fee: fee.toString(),
  extDataHash: extHash.toString(),
  recipientLo: external.recipientLo.toString(),
  recipientHi: external.recipientHi.toString(),
  relayerLo: external.relayerLo.toString(),
  relayerHi: external.relayerHi.toString(),
  chainDomain: external.domain.toString(),
  valueIn: value.toString(),
  blindingIn: blinding.toString(),
  rhoIn: rho.toString(),
  assetIn: asset.toString(),
  spendingKey: spendingKey.toString(),
  pathElements: membership.pathElements.map((item) => item.toString()),
  pathIndices: membership.pathIndices.map((item) => item.toString()),
  valueOut1: out1.value.toString(),
  blindingOut1: out1.blinding.toString(),
  rhoOut1: out1.rho.toString(),
  ownerOut1: out1.owner.toString(),
  assetOut1: asset.toString(),
  valueOut2: out2.value.toString(),
  blindingOut2: out2.blinding.toString(),
  rhoOut2: out2.rho.toString(),
  ownerOut2: out2.owner.toString(),
  assetOut2: asset.toString(),
};

const wasm = path.join(root, "circuits", "build", "shielded_transfer_js", "shielded_transfer.wasm");
const zkey = path.join(root, "circuits", "build", "shielded_transfer_final.zkey");
const { proof: zk, publicSignals } = await groth16.fullProve(witness, wasm, zkey);

const payload = {
  value: value.toString(),
  blinding: blinding.toString(),
  rho: rho.toString(),
  owner: owner.toString(),
  index,
  root: membership.root.toString(),
  nullifier: nullifier.toString(),
  pA: [zk.pi_a[0], zk.pi_a[1]],
  pB: [
    [zk.pi_b[0][1], zk.pi_b[0][0]],
    [zk.pi_b[1][1], zk.pi_b[1][0]],
  ],
  pC: [zk.pi_c[0], zk.pi_c[1]],
  pub: publicSignals,
  snarkjs: { pi_a: zk.pi_a, pi_b: zk.pi_b, pi_c: zk.pi_c },
};
process.stdout.write(`${JSON.stringify(payload)}\n`);
process.exit(0);

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function split128(value) {
  const mask = (1n << 128n) - 1n;
  return [value & mask, value >> 128n];
}

function limbsFrom32(bytes) {
  if (bytes.length !== 32) throw new Error("expected 32 bytes");
  const hi = BigInt(`0x${bytes.subarray(0, 16).toString("hex")}`);
  const lo = BigInt(`0x${bytes.subarray(16).toString("hex") || "0"}`);
  return [lo, hi];
}

function limbsFromHex(hex) {
  const body = hex.replace(/^0x/, "");
  if (body.length === 64) return limbsFrom32(Buffer.from(body, "hex"));
  return split128(BigInt(hex.startsWith("0x") ? hex : `0x${body}`));
}

function limbsFromAccount(account) {
  return limbsFrom32(createHash("sha256").update(account).digest());
}

function externalData(argv, fee) {
  const domain = BigInt(arg("--domain", "46630"));
  const recipientAccount = arg("--recipient-account", "");
  const relayerAccount = arg("--relayer-account", "");
  const recipientHex = arg("--recipient-hex", "");
  const relayerHex = arg("--relayer-hex", "");
  const [recipientLo, recipientHi] = recipientAccount
    ? limbsFromAccount(recipientAccount)
    : limbsFromHex(recipientHex || "0xBEEF");
  const [relayerLo, relayerHi] = relayerAccount
    ? limbsFromAccount(relayerAccount)
    : limbsFromHex(relayerHex || "0x0");
  void fee;
  void argv;
  return { recipientLo, recipientHi, relayerLo, relayerHi, domain };
}
