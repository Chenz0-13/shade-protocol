export interface ShieldedNote {
  commitment: bigint;
  nullifier: bigint;
  encryptedValue: Buffer;
  stealthAddress: string;
}

export interface PrivacyKeyPair {
  spendKey: Uint8Array;
  viewKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface EncryptedOrder {
  encryptedAmount: Buffer;
  encryptedDirection: Buffer;
  commitment: bigint;
  priceRange: [bigint, bigint];
  timestamp: number;
  nullifier: bigint;
}

export interface MatchResult {
  buyNullifier: bigint;
  sellNullifier: bigint;
  proof: Record<string, unknown>;
  outputNotes: ShieldedNote[];
}

export interface KYCCredential {
  userId: string;
  jurisdiction: string;
  accreditedInvestor: boolean;
  kycLevel: 1 | 2 | 3;
  issuedAt: number;
  expiresAt: number;
}

export interface ZKKYCProof {
  proof: Record<string, unknown>;
  publicSignals: {
    credentialHash: string;
    jurisdictionFlag: string;
    kycLevel: string;
    expiryValid: string;
  };
  walletAddress: string;
}

export function hashString(value: string): bigint {
  let hash = 0n;
  for (const ch of value) {
    hash = (hash * 131n + BigInt(ch.charCodeAt(0))) & 0xffffffffffffffffn;
  }
  return hash;
}
