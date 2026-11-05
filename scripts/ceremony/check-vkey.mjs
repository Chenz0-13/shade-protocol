import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ceremonyRoot, sha256Text } from "./lib.mjs";

const vkeyPath = path.join(ceremonyRoot, "circuits", "build", "verification_key.json");
const solPath = path.join(ceremonyRoot, "contracts", "evm", "src", "Verifier.sol");
if (!existsSync(vkeyPath) || !existsSync(solPath)) {
  throw new Error("Run npm run circuit:setup before checking the verifier.");
}

const vkey = JSON.parse(readFileSync(vkeyPath, "utf8"));
const source = readFileSync(solPath, "utf8");

function constant(name) {
  const match = source.match(new RegExp(`uint256 constant ${name}\\s*=\\s*(\\d+);`));
  if (!match) throw new Error(`Verifier.sol is missing ${name}`);
  return match[1];
}

const checks = [
  ["alphax", vkey.vk_alpha_1[0]],
  ["alphay", vkey.vk_alpha_1[1]],
  ["betax1", vkey.vk_beta_2[0][1]],
  ["betax2", vkey.vk_beta_2[0][0]],
  ["betay1", vkey.vk_beta_2[1][1]],
  ["betay2", vkey.vk_beta_2[1][0]],
  ["deltax1", vkey.vk_delta_2[0][1]],
  ["deltax2", vkey.vk_delta_2[0][0]],
  ["deltay1", vkey.vk_delta_2[1][1]],
  ["deltay2", vkey.vk_delta_2[1][0]],
];
for (let i = 0; i < vkey.IC.length; i += 1) {
  checks.push([`IC${i}x`, vkey.IC[i][0]]);
  checks.push([`IC${i}y`, vkey.IC[i][1]]);
}
for (const [name, expected] of checks) {
  const actual = constant(name);
  if (actual !== expected) {
    throw new Error(`${name} in Verifier.sol is ${actual}, verification key has ${expected}`);
  }
}

const digest = sha256Text(`${JSON.stringify(vkey)}\n`);
const published = path.join(ceremonyRoot, "circuits", "ceremony", "published", "shielded_transfer.vkey-hash.json");
if (existsSync(published)) {
  const record = JSON.parse(readFileSync(published, "utf8"));
  if (record.vkeySha256 && record.vkeySha256 !== sha256Text(readFileSync(vkeyPath, "utf8"))) {
    throw new Error("Published vkey hash does not match circuits/build/verification_key.json");
  }
}
process.stdout.write(`Verifier constants match verification_key.json (${digest.slice(0, 16)}...). Ceremony has not started.\n`);
