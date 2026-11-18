import type { webcrypto } from "node:crypto";
import { bytesToHex, hexToBytes } from "../core/crypto/field.js";
import type { PrivacyKeys } from "../core/crypto/keys.js";
import { ownerAddress } from "../core/crypto/note.js";
import { base64ToBytes, bytesToBase64, copyBytes } from "./bytes.js";

/**
 * Notes stay in the browser. The encryption key is HKDF(wallet signature),
 * so the backup file does not contain a private key or the signature.
 */
export const VAULT_MESSAGE =
  "Shader Protocol testnet note vault. Sign to unlock notes saved in this browser. This is not a transaction and it does not move funds.";

const HKDF_INFO = new TextEncoder().encode("shade.vault.notes.v1");

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export interface VaultIdentity {
  spendingKey: string;
  ownerPub: string;
  viewPrivateKey: string;
  viewPublicKey: string;
  spendPrivateKey: string;
  spendPublicKey: string;
}

export interface VaultNote {
  id: string;
  chainKey: string;
  commitment: string;
  value: string;
  blinding: string;
  rho: string;
  assetId: string;
  chainHome: string;
  ownerPub: string;
  leafIndex: number | null;
  memo: string;
  spent: boolean;
  createdAt: string;
  originTx: string;
}

export interface VaultPayload {
  identity: VaultIdentity | null;
  notes: VaultNote[];
}

export interface VaultBackupFile {
  version: 1;
  kdf: "HKDF-SHA-256";
  cipher: "AES-256-GCM";
  salt: string;
  iv: string;
  ciphertext: string;
}

export function emptyVault(): VaultPayload {
  return { identity: null, notes: [] };
}

export function identityFromKeys(keys: PrivacyKeys): VaultIdentity {
  return {
    spendingKey: keys.spendingKey.toString(),
    ownerPub: keys.ownerPub.toString(),
    viewPrivateKey: bytesToHex(keys.viewPrivateKey),
    viewPublicKey: bytesToHex(keys.viewPublicKey),
    spendPrivateKey: bytesToHex(keys.spendPrivateKey),
    spendPublicKey: bytesToHex(keys.spendPublicKey),
  };
}

export function keysFromIdentity(identity: VaultIdentity): PrivacyKeys {
  const spendingKey = BigInt(identity.spendingKey);
  const ownerPub = BigInt(identity.ownerPub);
  if (ownerAddress(spendingKey) !== ownerPub) {
    throw new VaultError("The saved shielded identity does not match its spending key.");
  }
  return {
    spendingKey,
    ownerPub,
    viewPrivateKey: hexToBytes(identity.viewPrivateKey),
    viewPublicKey: hexToBytes(identity.viewPublicKey),
    spendPrivateKey: hexToBytes(identity.spendPrivateKey),
    spendPublicKey: hexToBytes(identity.spendPublicKey),
  };
}

export function shieldedBalance(notes: readonly VaultNote[], chainKey: string): bigint {
  let total = 0n;
  for (const note of notes) {
    if (note.chainKey !== chainKey || note.spent) continue;
    const value = BigInt(note.value);
    if (value < 0n) throw new VaultError("A note amount is invalid.");
    total += value;
  }
  return total;
}

export async function deriveVaultKey(signature: Uint8Array, salt: Uint8Array): Promise<webcrypto.CryptoKey> {
  if (signature.byteLength < 32) throw new VaultError("The wallet signature is too short to unlock notes.");
  if (salt.byteLength < 16) throw new VaultError("The note backup salt is invalid.");
  const subtle = subtleCrypto();
  const material = await subtle.importKey("raw", copyBytes(signature), "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: copyBytes(salt), info: HKDF_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function randomVaultSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

export async function encryptVault(
  payload: VaultPayload,
  key: webcrypto.CryptoKey,
  salt: Uint8Array,
): Promise<VaultBackupFile> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const sealed = new Uint8Array(
    await subtleCrypto().encrypt({ name: "AES-GCM", iv: copyBytes(iv) }, key, copyBytes(plaintext)),
  );
  return {
    version: 1,
    kdf: "HKDF-SHA-256",
    cipher: "AES-256-GCM",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(sealed),
  };
}

export async function decryptVault(file: VaultBackupFile, key: webcrypto.CryptoKey): Promise<VaultPayload> {
  const parsed = parseBackupFile(file);
  try {
    const plain = await subtleCrypto().decrypt(
      { name: "AES-GCM", iv: copyBytes(parsed.iv) },
      key,
      copyBytes(parsed.ciphertext),
    );
    return parsePayload(JSON.parse(new TextDecoder().decode(plain)) as unknown);
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError("Could not unlock these notes. The wallet signature does not match this backup.");
  }
}

export function parseBackupFile(value: unknown): { iv: Uint8Array; ciphertext: Uint8Array; salt: Uint8Array } {
  if (!isRecord(value)) throw new VaultError("This backup file is not a Shader notes backup.");
  if (value.version !== 1 || value.kdf !== "HKDF-SHA-256" || value.cipher !== "AES-256-GCM") {
    throw new VaultError("This backup file is not a Shader notes backup.");
  }
  if (typeof value.salt !== "string" || typeof value.iv !== "string" || typeof value.ciphertext !== "string") {
    throw new VaultError("This backup file is not a Shader notes backup.");
  }
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = base64ToBytes(value.salt);
    iv = base64ToBytes(value.iv);
    ciphertext = base64ToBytes(value.ciphertext);
  } catch {
    throw new VaultError("This backup file is not a Shader notes backup.");
  }
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || ciphertext.byteLength < 16) {
    throw new VaultError("This backup file is not a Shader notes backup.");
  }
  return { salt, iv, ciphertext };
}

function parsePayload(value: unknown): VaultPayload {
  if (!isRecord(value) || !Array.isArray(value.notes)) throw new VaultError("The unlocked notes were not readable.");
  const identity = value.identity === null ? null : parseIdentity(value.identity);
  return { identity, notes: value.notes.map(parseNote) };
}

function parseIdentity(value: unknown): VaultIdentity {
  if (!isRecord(value)) throw new VaultError("The unlocked notes were not readable.");
  const identity: VaultIdentity = {
    spendingKey: requiredString(value.spendingKey),
    ownerPub: requiredString(value.ownerPub),
    viewPrivateKey: requiredString(value.viewPrivateKey),
    viewPublicKey: requiredString(value.viewPublicKey),
    spendPrivateKey: requiredString(value.spendPrivateKey),
    spendPublicKey: requiredString(value.spendPublicKey),
  };
  keysFromIdentity(identity);
  return identity;
}

function parseNote(value: unknown): VaultNote {
  if (!isRecord(value)) throw new VaultError("The unlocked notes were not readable.");
  const leafIndex = value.leafIndex;
  if (leafIndex !== null && (typeof leafIndex !== "number" || !Number.isInteger(leafIndex) || leafIndex < 0)) {
    throw new VaultError("The unlocked notes were not readable.");
  }
  if (typeof value.spent !== "boolean") throw new VaultError("The unlocked notes were not readable.");
  return {
    id: requiredString(value.id),
    chainKey: requiredString(value.chainKey),
    commitment: requiredString(value.commitment),
    value: requiredString(value.value),
    blinding: requiredString(value.blinding),
    rho: requiredString(value.rho),
    assetId: requiredString(value.assetId),
    chainHome: requiredString(value.chainHome),
    ownerPub: requiredString(value.ownerPub),
    leafIndex,
    memo: optionalString(value.memo),
    spent: value.spent,
    createdAt: requiredString(value.createdAt),
    originTx: optionalString(value.originTx),
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new VaultError("The unlocked notes were not readable.");
  return value;
}

function optionalString(value: unknown): string {
  if (typeof value !== "string") throw new VaultError("The unlocked notes were not readable.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function subtleCrypto(): webcrypto.SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new VaultError("This browser cannot encrypt notes.");
  return subtle;
}
