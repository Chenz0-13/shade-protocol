import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ceremonyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const workDir = path.join(ceremonyRoot, "circuits", "ceremony");
export const pin = JSON.parse(readFileSync(path.join(ceremonyRoot, "scripts", "ceremony", "ptau-pin.json"), "utf8"));
export const snarkjs = path.join(ceremonyRoot, "node_modules", "snarkjs", "build", "cli.cjs");

export const potPath = path.join(workDir, pin.name);
export const r1csDir = path.join(workDir, "r1cs");
export const zkeyDir = path.join(workDir, "zkeys");

export function ensureWork() {
  mkdirSync(workDir, { recursive: true });
  mkdirSync(r1csDir, { recursive: true });
  mkdirSync(zkeyDir, { recursive: true });
}

export function blake2b512(file) {
  return createHash("blake2b512").update(readFileSync(file)).digest("hex");
}

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function run(args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ceremonyRoot, stdio: "inherit", ...extra });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.slice(0, 3).join(" ")} exited ${code}`));
    });
  });
}

export async function snark(...args) {
  if (!existsSync(snarkjs)) throw new Error("snarkjs is not installed. Run npm install.");
  await run([snarkjs, ...args]);
}

export function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

export function refuseLiveCeremony() {
  if (process.env.SHADE_CEREMONY_ACK !== "circuits-not-frozen") {
    process.stderr.write(
      "Ceremony not started. Circuits are not frozen. Set SHADE_CEREMONY_ACK=circuits-not-frozen only when you mean to exercise the tooling, not to publish keys.\n",
    );
    process.exit(2);
  }
}
