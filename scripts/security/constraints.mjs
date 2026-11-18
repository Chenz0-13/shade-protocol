import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const snapshotPath = path.join(root, "circuits", "constraint-snapshot.json");
const circuits = ["shielded_transfer.circom", "transfer.circom", "teleport_out.circom", "allowance_spend.circom"];

function constraintsOf(file) {
  const dir = mkdtempSync(path.join(tmpdir(), "shade-r1cs-"));
  const compiled = spawnSync("circom", [path.join("circuits", file), "--r1cs", "-l", "node_modules", "-o", dir], {
    cwd: root,
    encoding: "utf8",
  });
  if (compiled.status !== 0) throw new Error(compiled.stderr || compiled.stdout || `circom ${file}`);
  const r1cs = path.join(dir, file.replace(".circom", ".r1cs"));
  const info = spawnSync(process.execPath, ["node_modules/snarkjs/build/cli.cjs", "r1cs", "info", r1cs], {
    cwd: root,
    encoding: "utf8",
  });
  const match = `${info.stdout}\n${info.stderr}`.match(/Constraints:\s+(\d+)/);
  if (!match) throw new Error(`no constraint count for ${file}\n${info.stdout}\n${info.stderr}`);
  return Number(match[1]);
}

const counts = {};
for (const file of circuits) counts[file] = constraintsOf(file);
if (process.argv.includes("--write")) {
  writeFileSync(snapshotPath, `${JSON.stringify(counts, null, 2)}\n`);
  process.stdout.write(`wrote ${snapshotPath}\n`);
} else {
  const expected = JSON.parse(readFileSync(snapshotPath, "utf8"));
  for (const file of circuits) {
    if (expected[file] !== counts[file]) {
      throw new Error(`${file} has ${counts[file]} constraints, snapshot says ${expected[file]}`);
    }
  }
  process.stdout.write(`constraint snapshot matches\n${JSON.stringify(counts)}\n`);
}
