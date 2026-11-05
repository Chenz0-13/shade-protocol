import { describe, expect, it } from "vitest";
import { generatePrivacyKeys, publicIdentity } from "../src/core/crypto/keys.js";
import { readNote } from "../src/core/notes/outgoing.js";
import { buildPayrollBatch } from "../src/core/payroll/batch.js";
import { recognizeStealthAddress } from "../src/core/crypto/stealth.js";

describe("private payroll", () => {
  it("pays stealth addresses and separates chain homes", () => {
    const alice = generatePrivacyKeys();
    const bob = generatePrivacyKeys();
    const batch = buildPayrollBatch({
      assetId: 1n,
      chainHome: 46630n,
      lines: [
        { recipient: publicIdentity(alice), value: 30n },
        { recipient: publicIdentity(bob), value: 70n, memo: "second" },
      ],
    });
    expect(batch.total).toBe(100n);
    expect(readNote(alice, batch.notes[0]!).value).toBe(30n);
    expect(readNote(bob, batch.notes[1]!).memo).toBe("second");
    expect(
      recognizeStealthAddress(
        alice.viewPrivateKey,
        alice.spendPublicKey,
        batch.notes[0]!.ephemeralPublicKey,
        Buffer.from(batch.notes[0]!.stealthAddress, "hex"),
      ),
    ).toBe(true);
    const otherChain = buildPayrollBatch({
      assetId: 1n,
      chainHome: 99801n,
      lines: [{ recipient: publicIdentity(alice), value: 30n }],
    });
    expect(otherChain.notes[0]!.commitment).not.toBe(batch.notes[0]!.commitment);
  });

  it("rejects an empty batch and a zero line", () => {
    const alice = generatePrivacyKeys();
    expect(() => buildPayrollBatch({ assetId: 1n, chainHome: 1n, lines: [] })).toThrow(/empty/);
    expect(() =>
      buildPayrollBatch({
        assetId: 1n,
        chainHome: 1n,
        lines: [{ recipient: publicIdentity(alice), value: 0n }],
      }),
    ).toThrow(/positive/);
  });
});
