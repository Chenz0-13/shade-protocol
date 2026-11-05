import type { KYCCredential } from "../crypto/primitives.js";

/** Persistence boundary for issuer credentials. Callers supply the backend. */
export interface CredentialStore {
  get(userId: string): Promise<KYCCredential | null>;
  put(userId: string, credential: KYCCredential): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly records = new Map<string, KYCCredential>();

  async get(userId: string): Promise<KYCCredential | null> {
    const found = this.records.get(userId);
    return found ? { ...found } : null;
  }

  async put(userId: string, credential: KYCCredential): Promise<void> {
    this.records.set(userId, { ...credential });
  }
}
