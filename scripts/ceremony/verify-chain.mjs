import { readdirSync } from "node:fs";
import path from "node:path";
import { arg, ensureWork, r1csDir, refuseLiveCeremony, snark, zkeyDir } from "./lib.mjs";

refuseLiveCeremony();
ensureWork();
const circuit = arg("--circuit", "shielded_transfer");
const r1cs = path.join(r1csDir, `${circuit}.r1cs`);
const keys = readdirSync(zkeyDir)
  .filter((file) => file.startsWith(`${circuit}_`) && file.endsWith(".zkey"))
  .sort();
if (keys.length === 0) throw new Error(`No contribution zkeys for ${circuit}.`);
for (const file of keys) {
  process.stdout.write(`Verifying ${file}\n`);
  await snark("zkey", "verify", r1cs, path.join(zkeyDir, file));
}
process.stdout.write(`Verified ${keys.length} contribution file(s). One honest contribution is enough to make the result safe, if the circuit was frozen first.\n`);
