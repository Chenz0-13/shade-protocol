import { describe, expect, it } from "vitest";
import { privacyEstimate } from "../src/app/privacy.js";

describe("privacy estimate", () => {
  it("stays empty until the pool note count is known", () => {
    expect(privacyEstimate(null).score).toBeNull();
    expect(privacyEstimate(0n)).toEqual({ score: 0, text: "Estimate. An empty pool does not hide a payment." });
    const some = privacyEstimate(8n);
    expect(some.score).toBeGreaterThan(0);
    expect(some.score).toBeLessThan(100);
    expect(some.text).toMatch(/Not a privacy guarantee/);
  });
});
