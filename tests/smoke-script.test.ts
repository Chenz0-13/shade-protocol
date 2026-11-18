import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../scripts/smoke-deployment.mjs", import.meta.url), "utf8");

describe("smoke deployment script", () => {
  it("broadcasts the NEAR transaction as base64 and gives the withdraw enough gas", () => {
    expect(source).toContain('nearRpc(params.rpc, "broadcast_tx_commit", [signed.toString("base64")])');
    expect(source).not.toContain("broadcast_tx_commit\", [bs58.encode(signed)]");
    const withdraw = source.slice(source.indexOf('methodName: "shielded_transfer"'));
    expect(withdraw).toContain("gas: 1_000_000_000_000_000n");
  });
});
