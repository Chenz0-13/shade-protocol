import { afterEach, describe, expect, it } from "vitest";
import { logger, redact, setLogSink } from "../src/core/log/logger.js";

afterEach(() => setLogSink(null));

describe("logger", () => {
  it("never prints secret material", () => {
    const spendingKey = "spend-key-should-not-appear-9f3a";
    const apiKey = "rk_live_should-not-appear";
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    logger.info("shade initialized", {
      chains: ["solana"],
      spendingKey,
      apiKey,
      viewPrivateKey: new Uint8Array([1, 2, 3, 4]),
      solanaRpc: "https://api.devnet.solana.com",
    });
    const text = lines.join("\n");
    expect(text).not.toContain(spendingKey);
    expect(text).not.toContain(apiKey);
    expect(text).not.toContain("01020304");
    expect(text).toContain("solana");
    expect(text).toContain("[redacted]");
    expect(redact(new Uint8Array([9, 9, 9]))).toBe("[bytes:3]");
  });
});
