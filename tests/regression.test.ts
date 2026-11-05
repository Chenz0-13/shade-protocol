import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (full.endsWith(".ts") || full.endsWith(".circom")) files.push(full);
  }
  return files;
}

describe("no simulated cryptography", () => {
  it("does not contain the scaffold's fake proof paths", () => {
    const text = sourceFiles("src")
      .concat(sourceFiles("circuits"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(text).not.toContain("mock: true");
    expect(text).not.toContain('protocol: "groth16", mock');
    expect(text).not.toContain("valid <== 1");
    expect(text).not.toContain("out <== value + blinding");
    expect(text).not.toContain("left ^ right");
    expect(text).not.toContain("validateProof(): boolean");
  });
});
