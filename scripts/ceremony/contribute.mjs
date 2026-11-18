import { existsSync } from "node:fs";
import path from "node:path";
import { arg, ensureWork, potPath, r1csDir, refuseLiveCeremony, snark, zkeyDir } from "./lib.mjs";

refuseLiveCeremony();
ensureWork();
if (!existsSync(potPath)) {
  throw new Error("Missing the pinned Powers of Tau file. Run scripts/ceremony/init.mjs first.");
}

const circuit = arg("--circuit", "shielded_transfer");
const name = arg("--name", "");
const entropy = arg("--entropy", "");
if (!name || !entropy) {
  throw new Error("Usage: node scripts/ceremony/contribute.mjs --circuit shielded_transfer --name <contributor> --entropy <secret>");
}

const r1cs = path.join(r1csDir, `${circuit}.r1cs`);
if (!existsSync(r1cs)) {
  await snark("r1cs", "info", path.join("circuits", `${circuit}.circom`)).catch(() => undefined);
  throw new Error(`Compile ${circuit}.circom to ${r1cs} with circom --r1cs --O0 before contributing.`);
}

const initial = path.join(zkeyDir, `${circuit}_0000.zkey`);
if (!existsSync(initial)) {
  await snark("groth16", "setup", r1cs, potPath, initial);
}

const files = existsSync(zkeyDir) ? (await import("node:fs")).readdirSync(zkeyDir).filter((file) => file.startsWith(`${circuit}_`) && file.endsWith(".zkey")) : [];
const next = files.length;
const input = next === 0 ? initial : path.join(zkeyDir, `${circuit}_${String(next - 1).padStart(4, "0")}.zkey`);
const output = path.join(zkeyDir, `${circuit}_${String(next).padStart(4, "0")}.zkey`);
await snark("zkey", "contribute", input, output, "--name", name, "-e", entropy, "-v");
process.stdout.write(`Wrote ${output}. This is tooling output, not a ceremony.\n`);
