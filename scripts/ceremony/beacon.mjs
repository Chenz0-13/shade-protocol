import { readdirSync } from "node:fs";
import path from "node:path";
import { arg, ensureWork, refuseLiveCeremony, snark, zkeyDir } from "./lib.mjs";

refuseLiveCeremony();
ensureWork();
const circuit = arg("--circuit", "shielded_transfer");
const keys = readdirSync(zkeyDir)
  .filter((file) => file.startsWith(`${circuit}_`) && file.endsWith(".zkey") && !file.includes("final"))
  .sort();
if (keys.length === 0) throw new Error("No contribution to beacon.");
const latest = path.join(zkeyDir, keys[keys.length - 1]);
const beacon = arg("--beacon", "");
let entropy = beacon;
if (!entropy) {
  const response = await fetch("https://drand.cloudflare.com/public/latest");
  if (!response.ok) throw new Error(`drand failed: ${response.status}`);
  const body = await response.json();
  entropy = `${body.round}:${body.randomness}`;
  process.stdout.write(`Using drand round ${body.round}.\n`);
}
const final = path.join(zkeyDir, `${circuit}_final.zkey`);
const before = arg("--before", new Date().toISOString());
await snark("zkey", "beacon", latest, final, entropy, "10", "-n", `shade-beacon-${before}`);
process.stdout.write(`Beacon applied to ${final}. Do not treat this as a finished ceremony.\n`);
