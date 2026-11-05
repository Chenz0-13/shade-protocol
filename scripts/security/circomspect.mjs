import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const allow = readFileSync(path.join(root, "circuits", "circomspect-allowlist.txt"), "utf8")
  .split("\n")
  .map((line) => line.replace(/#.*/, "").trim())
  .filter((line) => line.length > 0);

const files = [
  "circuits/shielded_transfer.circom",
  "circuits/transfer.circom",
  "circuits/teleport_out.circom",
  "circuits/allowance_spend.circom",
  "circuits/lib/common.circom",
];

for (const file of files) {
  const args = [file, "-L", "node_modules", ...allow.flatMap((id) => ["--allow", id])];
  const result = spawnSync("circomspect", args, { cwd: root, encoding: "utf8" });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || /warning|error/i.test(text)) {
    throw new Error(`circomspect failed on ${file}\n${text}`);
  }
  process.stdout.write(`${file}: ${text.trim() || "clean"}\n`);
}
