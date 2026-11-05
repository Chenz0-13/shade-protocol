import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { poseidon2, poseidon3, poseidon6 } from "poseidon-lite";
import { poseidon } from "../src/core/crypto/poseidon.js";

interface VectorFile {
  count: number;
  cases: { inputs: string[]; hash: string }[];
}

const vectors = JSON.parse(
  readFileSync("contracts/shade-crypto/testdata/poseidon-vectors.json", "utf8"),
) as VectorFile;

const lite = { 2: poseidon2, 3: poseidon3, 6: poseidon6 } as const;

describe("Poseidon matches circomlib", () => {
  it("agrees with poseidon-lite on every shared vector", () => {
    expect(vectors.cases).toHaveLength(vectors.count);
    for (const vector of vectors.cases) {
      const inputs = vector.inputs.map((item) => BigInt(item));
      const expected = BigInt(vector.hash);
      const hasher = lite[inputs.length as 2 | 3 | 6];
      expect(hasher(inputs)).toBe(expected);
      expect(poseidon(inputs)).toBe(expected);
    }
  });
});
