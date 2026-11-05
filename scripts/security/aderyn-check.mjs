import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sarifPath = process.argv[2] ?? path.join(root, "contracts/evm/aderyn.sarif");
const acceptPath = path.join(root, "contracts/evm/aderyn-accept.txt");
const accepted = new Set(
  readFileSync(acceptPath, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line.length > 0),
);
const sarif = JSON.parse(readFileSync(sarifPath, "utf8"));
const seen = new Set();
for (const run of sarif.runs ?? []) {
  for (const result of run.results ?? []) {
    const id = result.ruleId ?? "unknown";
    seen.add(id);
    if (!accepted.has(id)) {
      const text = result.message?.text ?? "";
      throw new Error(`aderyn rule ${id} is not in aderyn-accept.txt\n${text}`);
    }
  }
}
process.stdout.write(`aderyn rules accepted: ${[...seen].sort().join(", ") || "none"}\n`);
