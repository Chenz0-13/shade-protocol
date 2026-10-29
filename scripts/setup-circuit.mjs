import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "circuits", "build");
const circuit = path.join(root, "circuits", "shielded_transfer.circom");
const r1cs = path.join(buildDir, "shielded_transfer.r1cs");
const wasm = path.join(buildDir, "shielded_transfer_js", "shielded_transfer.wasm");
const zkey = path.join(buildDir, "shielded_transfer_final.zkey");
const vkey = path.join(buildDir, "verification_key.json");
const snarkjs = path.join(root, "node_modules", "snarkjs", "build", "cli.cjs");
const force = process.argv.includes("--force");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args[0] ?? ""} exited ${code}`));
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${command} ${args[0] ?? ""} exited ${code}\n${out}`));
    });
  });
}

function artifactsFresh() {
  if (![r1cs, wasm, zkey, vkey].every((file) => existsSync(file))) return false;
  const newestInput = Math.max(
    statSync(circuit).mtimeMs,
    statSync(path.join(root, "node_modules", "circomlib", "circuits", "poseidon.circom")).mtimeMs,
  );
  return statSync(vkey).mtimeMs >= newestInput;
}

function entropy() {
  return randomBytes(32).toString("hex");
}

async function main() {
  if (!existsSync(snarkjs)) {
    throw new Error("snarkjs is not installed. Run npm install.");
  }
  if (!force && artifactsFresh()) {
    log("circuit artifacts are up to date");
    return;
  }

  log("DEV-ONLY trusted setup. This is a single-party development setup, not a ceremony.");
  log("Do not deploy these keys. A production deployment needs a multi-party ceremony.");

  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });

  await run("circom", [
    circuit,
    "--r1cs",
    "--wasm",
    "--sym",
    "-l",
    "node_modules",
    "-o",
    buildDir,
  ]);

  const info = await runCapture("node", [snarkjs, "r1cs", "info", r1cs]);
  const match = info.match(/Constraints:\s+(\d+)/);
  if (!match) throw new Error(`could not read constraint count\n${info}`);
  const constraints = Number(match[1]);
  let power = 8;
  while (2 ** power < constraints + 1) power += 1;
  if (power > 16) {
    throw new Error(`circuit has ${constraints} constraints, which is too large for the dev setup`);
  }
  log(`circuit constraints: ${constraints}; powers of tau: 2^${power}`);

  const pot0 = path.join(buildDir, "pot_0000.ptau");
  const pot1 = path.join(buildDir, "pot_0001.ptau");
  const potFinal = path.join(buildDir, "pot_final.ptau");
  const zkey0 = path.join(buildDir, "shielded_transfer_0000.zkey");

  await run("node", [snarkjs, "powersoftau", "new", "bn128", String(power), pot0, "-v"]);
  await run("node", [
    snarkjs,
    "powersoftau",
    "contribute",
    pot0,
    pot1,
    "--name=shade-dev",
    "-v",
    `-e=${entropy()}`,
  ]);
  await run("node", [snarkjs, "powersoftau", "prepare", "phase2", pot1, potFinal, "-v"]);
  await run("node", [snarkjs, "groth16", "setup", r1cs, potFinal, zkey0]);
  await run("node", [
    snarkjs,
    "zkey",
    "contribute",
    zkey0,
    zkey,
    "--name=shade-dev",
    "-v",
    `-e=${entropy()}`,
  ]);
  await run("node", [snarkjs, "zkey", "export", "verificationkey", zkey, vkey]);
  const verifier = path.join(root, "contracts", "evm", "src", "Verifier.sol");
  await run("node", [snarkjs, "zkey", "export", "solidityverifier", zkey, verifier]);

  for (const file of [pot0, pot1, potFinal, zkey0]) rmSync(file, { force: true });
  const marker = {
    devOnly: true,
    warning: "Single-party development setup. Not a production trusted ceremony.",
    constraints,
    power,
  };
  log(JSON.stringify(marker));
  // Touch the verification key mtime after writing the marker comment into a sidecar.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path.join(buildDir, "DEV_SETUP.json"), `${JSON.stringify(marker, null, 2)}\n`);
  if (!readFileSync(vkey, "utf8").includes("protocol")) {
    throw new Error("verification key was not written");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
