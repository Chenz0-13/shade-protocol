import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { DOMAIN } from "../constants.js";
import { NotImplementedError } from "../errors.js";
import { fieldToBe32, sha256ToField, utf8 } from "../crypto/field.js";
import { poseidon } from "../crypto/poseidon.js";
import type { CredentialPresentation, KYCCredential } from "../crypto/primitives.js";
import type { CredentialStore } from "./CredentialStore.js";
import type { SanctionsScreen } from "./SanctionsScreen.js";

export interface CompliancePolicy {
  requiredLevel: number;
  allowedJurisdictions: string[];
  now?: number;
}

export type VerificationResult =
  | { ok: true; credentialHash: string }
  | { ok: false; reason: string };

export interface IssuerKeys {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

export function generateIssuerKeys(): IssuerKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey };
}

/** Poseidon commitment to every credential field. Not a truncated checksum. */
export function hashCredential(credential: KYCCredential): bigint {
  const user = sha256ToField(utf8(`shade.user.v1|${credential.userId}`));
  const jurisdiction = sha256ToField(utf8(`shade.juris.v1|${credential.jurisdiction}`));
  return poseidon([
    DOMAIN.credential,
    user,
    BigInt(credential.kycLevel),
    BigInt(credential.expiresAt),
    BigInt(credential.issuedAt),
    jurisdiction,
    credential.accreditedInvestor ? 1n : 0n,
  ]);
}

function signingMessage(hash: bigint): Buffer {
  return Buffer.concat([utf8("shade.credential.v1\0"), fieldToBe32(hash)]);
}

function sameCredential(left: KYCCredential, right: KYCCredential): boolean {
  return (
    left.userId === right.userId &&
    left.jurisdiction === right.jurisdiction &&
    left.accreditedInvestor === right.accreditedInvestor &&
    left.kycLevel === right.kycLevel &&
    left.issuedAt === right.issuedAt &&
    left.expiresAt === right.expiresAt
  );
}

/**
 * Credential verification reads the issuer store and checks the issuer's
 * signature over that record. Fields supplied by the presenter are accepted
 * only when they match the stored credential. Self-asserted KYC levels,
 * jurisdictions, and expiry flags are ignored.
 *
 * A Groth16 selective-disclosure circuit is not part of the devnet artifact
 * set. Asking for one throws rather than returning a stand-in proof.
 */
export class ZKComplianceLayer {
  constructor(
    private readonly store: CredentialStore,
    private readonly sanctions: SanctionsScreen,
    private readonly issuerPublicKey: KeyObject,
    private readonly issuerPrivateKey?: KeyObject,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async issueCredential(credential: KYCCredential): Promise<CredentialPresentation> {
    if (!this.issuerPrivateKey) throw new Error("issuer private key is required to issue");
    if (![1, 2, 3].includes(credential.kycLevel)) throw new Error("kyc level must be 1, 2, or 3");
    if (credential.expiresAt <= credential.issuedAt) throw new Error("credential expiry is not after issuance");
    await this.store.put(credential.userId, credential);
    const stored = await this.store.get(credential.userId);
    if (!stored) throw new Error("credential store did not retain the credential");
    const signature = sign(null, signingMessage(hashCredential(stored)), this.issuerPrivateKey);
    return {
      userId: stored.userId,
      credential: stored,
      signature,
      walletAddress: "",
    };
  }

  async verifyPresentation(
    presentation: CredentialPresentation,
    policy: CompliancePolicy,
  ): Promise<VerificationResult> {
    const stored = await this.store.get(presentation.userId);
    if (!stored) return { ok: false, reason: "unknown credential" };
    if (!sameCredential(stored, presentation.credential)) {
      return { ok: false, reason: "presentation does not match the issuer store" };
    }
    const hash = hashCredential(stored);
    const signatureOk = verify(
      null,
      signingMessage(hash),
      this.issuerPublicKey,
      presentation.signature,
    );
    if (!signatureOk) return { ok: false, reason: "invalid issuer signature" };
    const now = policy.now ?? this.clock();
    if (stored.expiresAt <= now) return { ok: false, reason: "credential expired" };
    if (stored.kycLevel < policy.requiredLevel) return { ok: false, reason: "kyc level too low" };
    if (!policy.allowedJurisdictions.includes(stored.jurisdiction)) {
      return { ok: false, reason: "jurisdiction not allowed" };
    }
    if (await this.sanctions.isBlocked(presentation.walletAddress)) {
      return { ok: false, reason: "address blocked by sanctions screen" };
    }
    return { ok: true, credentialHash: hash.toString(16) };
  }

  generateGroth16KycProof(): never {
    throw new NotImplementedError(
      "Groth16 selective-disclosure KYC proofs are not in the devnet artifact set",
    );
  }
}
