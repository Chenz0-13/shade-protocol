import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allowanceCommitment, assertAllowancePayment, buildAllowanceWitness, x402Payment } from "../src/core/agent/allowance.js";
import { MerkleTree } from "../src/core/merkle/MerkleTree.js";

const opening = {
  value: 100n,
  cap: 40n,
  expiry: 1_000n,
  blinding: 11n,
  rho: 13n,
  spendingKey: 17n,
  assetId: 1n,
  chainHome: 46630n,
};

function validWitness() {
  const tree = MerkleTree.empty();
  const commitment = allowanceCommitment(opening);
  const index = tree.insert(commitment);
  const proof = tree.getProof(index);
  return buildAllowanceWitness({
    opening,
    amount: 25n,
    now: 500n,
    pathElements: proof.pathElements,
    pathIndices: proof.pathIndices,
    root: proof.root,
  });
}

describe("allowance notes", () => {
  it("rejects a payment over the cap and an expired note", () => {
    expect(() => assertAllowancePayment(opening, 41n, 10n)).toThrow(/cap/);
    expect(() => assertAllowancePayment(opening, 10n, 1_001n)).toThrow(/expired/);
    const payment = x402Payment(opening, 25n, 500n, "https://example.test/resource", 0n);
    expect(payment.amount).toBe("25");
    expect(payment.expiry).toBe("1000");
  });

  it("the circuit rejects an over-cap spend and an expired now", () => {
    const wasm = compileAllowance();
    const witness = validWitness();
    expect(witnessOk(wasm, witness)).toBe(true);
    const overCap = { ...witness, amount: "41" };
    expect(witnessOk(wasm, overCap)).toBe(false);
    const expired = { ...witness, now: "1001" };
    expect(witnessOk(wasm, expired)).toBe(false);
  });
});

function compileAllowance(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "shade-allow-"));
  const compiled = spawnSync(
    "circom",
    ["circuits/allowance_spend.circom", "--wasm", "-l", "node_modules", "-o", dir],
    { encoding: "utf8" },
  );
  if (compiled.status !== 0) {
    throw new Error(compiled.stderr || compiled.stdout || "circom failed");
  }
  return path.join(dir, "allowance_spend_js", "allowance_spend.wasm");
}

function witnessOk(wasm: string, witness: Record<string, string | string[]>): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), "shade-wtns-"));
  const input = path.join(dir, "input.json");
  writeFileSync(input, JSON.stringify(witness));
  const result = spawnSync(
    process.execPath,
    ["node_modules/snarkjs/build/cli.cjs", "wtns", "calculate", wasm, input, path.join(dir, "out.wtns")],
    { encoding: "utf8" },
  );
  return result.status === 0;
}
