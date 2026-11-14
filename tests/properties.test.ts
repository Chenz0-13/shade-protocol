import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DOMAIN, MAX_VALUE } from "../src/core/constants.js";
import { noteCommitment, noteNullifier } from "../src/core/crypto/note.js";
import { extDataHash } from "../src/core/proof/extData.js";

const value = fc.bigInt({ min: 0n, max: MAX_VALUE });
const field = fc.bigInt({ min: 1n, max: MAX_VALUE });

describe("note properties", () => {
  it("conserves value only when the caller splits it", () => {
    fc.assert(
      fc.property(value, value, value, (input, out1, fee) => {
        const out2 = input - out1 - fee;
        const conserves = out2 >= 0n && out2 <= MAX_VALUE && out1 + out2 + fee === input;
        expect(conserves).toBe(out1 + fee <= input);
      }),
    );
  });

  it("rejects values outside the 64-bit range", () => {
    expect(() => noteCommitment({ value: MAX_VALUE + 1n, blinding: 1n, rho: 1n, ownerPub: 1n, assetId: 1n, chainHome: 1n })).toThrow(/64/);
  });

  it("gives duplicate rho notes different nullifiers", () => {
    fc.assert(
      fc.property(field, field, field, (key, rho, blinding) => {
        const first = noteCommitment({ value: 5n, blinding, rho, ownerPub: 1n, assetId: 1n, chainHome: 46630n });
        const second = noteCommitment({ value: 5n, blinding: blinding + 1n, rho, ownerPub: 1n, assetId: 1n, chainHome: 46630n });
        expect(noteNullifier(key, first, 0n)).not.toBe(noteNullifier(key, second, 1n));
      }),
    );
  });

  it("binds the pool, the withdraw amount, and the relayer fee into extDataHash", () => {
    fc.assert(
      fc.property(field, field, (withdraw, fee) => {
        const limbs = {
          recipientLo: 1n,
          recipientHi: 2n,
          relayerLo: 3n,
          relayerHi: 4n,
          poolLo: 5n,
          poolHi: 6n,
          chainDomain: 46630n,
        };
        const bound = extDataHash(limbs, withdraw, fee);
        expect(bound).not.toBe(extDataHash({ ...limbs, poolLo: limbs.poolLo + 1n }, withdraw, fee));
        if (withdraw !== fee) expect(bound).not.toBe(extDataHash(limbs, fee, withdraw));
        expect(DOMAIN.ext).toBe(5n);
      }),
    );
  });
});
