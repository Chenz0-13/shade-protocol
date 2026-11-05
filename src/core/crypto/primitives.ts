import type { Groth16Proof } from "snarkjs";

export interface ShieldedNote {
  commitment: bigint;
  nullifier: bigint | null;
  encryptedValue: Buffer;
  stealthAddress: string;
  assetId: bigint;
  leafIndex?: number;
}

export interface NotePlaintext {
  value: bigint;
  blinding: bigint;
  rho: bigint;
  assetId: bigint;
  memo: string;
}

export interface KYCCredential {
  userId: string;
  jurisdiction: string;
  accreditedInvestor: boolean;
  kycLevel: 1 | 2 | 3;
  issuedAt: number;
  expiresAt: number;
}

export interface CredentialPresentation {
  userId: string;
  credential: KYCCredential;
  signature: Uint8Array;
  walletAddress: string;
}

export interface MatchResult {
  buyNullifier: bigint;
  sellNullifier: bigint;
  proofs: Array<{ proof: Groth16Proof; publicSignals: string[] }>;
  outputNotes: ShieldedNote[];
}
