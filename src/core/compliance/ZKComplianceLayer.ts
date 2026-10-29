import { buildPoseidon } from "circomlibjs";
import { groth16 } from "snarkjs";
import { KYCCredential, ZKKYCProof } from "../crypto/primitives.js";

export class ZKComplianceLayer {
  private poseidon: any;
  private credentialStore: Map<string, KYCCredential>;

  async init(): Promise<void> {
    this.poseidon = await buildPoseidon();
    this.credentialStore = new Map();
  }

  issueCredential(userId: string, credential: KYCCredential): string {
    this.credentialStore.set(userId, credential);

    const commitment = this.poseidon([
      BigInt(userId.split("").reduce((a, c) => a + c.charCodeAt(0), 0)),
      BigInt(credential.kycLevel),
      BigInt(credential.expiresAt),
    ]);

    return commitment.toString(16);
  }

  async generateKYCProof(
    userId: string,
    requiredLevel: number,
    allowedJurisdictions: string[],
    walletAddress: string
  ): Promise<ZKKYCProof> {
    const credential = this.credentialStore.get(userId);
    if (!credential) throw new Error("No credential found");
    if (credential.expiresAt < Date.now() / 1000) {
      throw new Error("Credential expired");
    }

    const credentialHash = this.poseidon([
      BigInt(userId.split("").reduce((a, c) => a + c.charCodeAt(0), 0)),
      BigInt(credential.kycLevel),
      BigInt(credential.expiresAt),
    ]);

    const jurisdictionFlag = allowedJurisdictions.includes(credential.jurisdiction)
      ? "1"
      : "0";

    const proof = {
      pi_a: ["0x1", "0x2"],
      pi_b: [["0x3", "0x4"], ["0x5", "0x6"]],
      pi_c: ["0x7", "0x8"],
      protocol: "groth16",
    };

    return {
      proof,
      publicSignals: {
        credentialHash: credentialHash.toString(16),
        jurisdictionFlag,
        kycLevel: credential.kycLevel.toString(),
        expiryValid: credential.expiresAt > Date.now() / 1000 ? "1" : "0",
      },
      walletAddress,
    };
  }

  async verifyKYCProof(
    zkProof: ZKKYCProof,
    verificationKey: object,
    requiredLevel: number
  ): Promise<boolean> {
    const { publicSignals } = zkProof;

    if (parseInt(publicSignals.kycLevel, 10) < requiredLevel) return false;
    if (publicSignals.jurisdictionFlag !== "1") return false;
    if (publicSignals.expiryValid !== "1") return false;

    const signals = Object.values(publicSignals);
    return groth16.verify(verificationKey, signals, zkProof.proof);
  }

  generateRegulatoryViewKey(
    walletRange: [string, string],
    regulatorId: string,
    expiresIn: number
  ): { viewKey: string; scope: object; expiresAt: number } {
    return {
      viewKey: Buffer.from(`${regulatorId}:${walletRange[0]}:${walletRange[1]}`).toString("base64"),
      scope: {
        walletStart: walletRange[0],
        walletEnd: walletRange[1],
        canDecryptAmounts: true,
        canDecryptCounterparties: false,
      },
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    };
  }
}
