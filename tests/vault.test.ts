import { describe, expect, it } from "vitest";
import { generatePrivacyKeys } from "../src/core/crypto/keys.js";
import {
  decryptVault,
  deriveVaultKey,
  emptyVault,
  encryptVault,
  identityFromKeys,
  keysFromIdentity,
  randomVaultSalt,
  shieldedBalance,
  type VaultNote,
  type VaultPayload,
} from "../src/app/vault.js";

function note(chainKey: string, value: string, spent = false): VaultNote {
  return {
    id: `${chainKey}-${value}-${spent ? "spent" : "open"}`,
    chainKey,
    commitment: "1",
    value,
    blinding: "2",
    rho: "3",
    assetId: "1",
    chainHome: "1001",
    ownerPub: "4",
    leafIndex: 0,
    memo: "",
    spent,
    createdAt: "2026-01-01T00:00:00.000Z",
    originTx: "none",
  };
}

async function unlock(signature: Uint8Array, salt = randomVaultSalt()) {
  const key = await deriveVaultKey(signature, salt);
  return { key, salt };
}

describe("note vault", () => {
  it("round-trips notes under a key derived from a wallet signature", async () => {
    const keys = generatePrivacyKeys();
    const signature = crypto.getRandomValues(new Uint8Array(65));
    const { key, salt } = await unlock(signature);
    const payload: VaultPayload = {
      identity: identityFromKeys(keys),
      notes: [note("solana-devnet", "1000"), note("solana-devnet", "5", true), note("base-sepolia", "7")],
    };
    const file = await encryptVault(payload, key, salt);
    const opened = await decryptVault(file, key);
    expect(opened.notes).toEqual(payload.notes);
    expect(keysFromIdentity(opened.identity!).spendingKey).toBe(keys.spendingKey);
    expect(shieldedBalance(opened.notes, "solana-devnet")).toBe(1000n);
    expect(shieldedBalance(opened.notes, "base-sepolia")).toBe(7n);
    expect(shieldedBalance(opened.notes, "missing")).toBe(0n);
  });

  it("does not put the spending key or signature in the backup file", async () => {
    const keys = generatePrivacyKeys();
    const signature = crypto.getRandomValues(new Uint8Array(64));
    const { key, salt } = await unlock(signature);
    const file = await encryptVault({ identity: identityFromKeys(keys), notes: [note("solana-devnet", "9")] }, key, salt);
    const serialized = JSON.stringify(file);
    expect(serialized).not.toContain(keys.spendingKey.toString());
    expect(serialized).not.toContain(Buffer.from(signature).toString("base64"));
    expect(serialized).not.toContain("spendingKey");
    expect(file.kdf).toBe("HKDF-SHA-256");
    expect(file.cipher).toBe("AES-256-GCM");
  });

  it("rejects a different signature, a tampered backup, and an unknown version", async () => {
    const signature = crypto.getRandomValues(new Uint8Array(64));
    const { key, salt } = await unlock(signature);
    const file = await encryptVault(emptyVault(), key, salt);
    const other = await deriveVaultKey(crypto.getRandomValues(new Uint8Array(64)), salt);
    await expect(decryptVault(file, other)).rejects.toThrow(/does not match/i);

    const tampered = { ...file, ciphertext: flip(file.ciphertext) };
    await expect(decryptVault(tampered, key)).rejects.toThrow(/does not match/i);
    await expect(decryptVault({ ...file, version: 2 as 1 }, key)).rejects.toThrow(/not a Shader notes backup/i);
    await expect(deriveVaultKey(new Uint8Array(8), salt)).rejects.toThrow(/too short/i);
  });
});

function flip(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[bytes.length - 1] ^= 0xff;
  return bytes.toString("base64");
}
