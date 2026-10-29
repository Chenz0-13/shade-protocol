import { describe, expect, it } from "vitest";
import { MemoryCredentialStore } from "../src/core/compliance/CredentialStore.js";
import { StaticSanctionsScreen } from "../src/core/compliance/SanctionsScreen.js";
import {
  generateIssuerKeys,
  hashCredential,
  ZKComplianceLayer,
} from "../src/core/compliance/ZKComplianceLayer.js";
import type { KYCCredential } from "../src/core/crypto/primitives.js";
import { NotImplementedError } from "../src/core/errors.js";

function credential(overrides: Partial<KYCCredential> = {}): KYCCredential {
  return {
    userId: "user-1",
    jurisdiction: "US",
    accreditedInvestor: false,
    kycLevel: 2,
    issuedAt: 1_700_000_000,
    expiresAt: 1_800_000_000,
    ...overrides,
  };
}

describe("compliance", () => {
  it("hashes every field and ignores prover-supplied upgrades", async () => {
    const issuer = generateIssuerKeys();
    const store = new MemoryCredentialStore();
    const layer = new ZKComplianceLayer(store, new StaticSanctionsScreen(new Set(["blocked"])), issuer.publicKey, issuer.privateKey);
    const base = credential();
    expect(hashCredential(base)).not.toBe(hashCredential({ ...base, kycLevel: 3 }));
    expect(hashCredential(base)).not.toBe(hashCredential({ ...base, jurisdiction: "IR" }));

    const presentation = await layer.issueCredential(base);
    presentation.walletAddress = "wallet-a";
    const policy = { requiredLevel: 2, allowedJurisdictions: ["US"], now: base.issuedAt + 10 };
    expect((await layer.verifyPresentation(presentation, policy)).ok).toBe(true);

    const upgraded = {
      ...presentation,
      credential: { ...presentation.credential, kycLevel: 3 as const },
    };
    expect((await layer.verifyPresentation(upgraded, { ...policy, requiredLevel: 3 })).ok).toBe(false);

    const resigned = {
      ...presentation,
      signature: Uint8Array.from(presentation.signature.map((byte) => byte ^ 1)),
    };
    expect((await layer.verifyPresentation(resigned, policy)).ok).toBe(false);

    expect(
      (await layer.verifyPresentation(presentation, { ...policy, now: base.expiresAt })).ok,
    ).toBe(false);
    expect(
      (await layer.verifyPresentation(presentation, { ...policy, allowedJurisdictions: ["DE"] })).ok,
    ).toBe(false);
    expect(
      (await layer.verifyPresentation({ ...presentation, walletAddress: "blocked" }, policy)).reason,
    ).toBe("address blocked by sanctions screen");
  });

  it("does not emit a fake Groth16 KYC proof", () => {
    const issuer = generateIssuerKeys();
    const layer = new ZKComplianceLayer(
      new MemoryCredentialStore(),
      new StaticSanctionsScreen(new Set()),
      issuer.publicKey,
      issuer.privateKey,
    );
    expect(() => layer.generateGroth16KycProof()).toThrow(NotImplementedError);
  });
});
