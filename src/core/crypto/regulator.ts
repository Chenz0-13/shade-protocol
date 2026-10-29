import { createHash, sign, verify, type KeyObject } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { DecryptionError } from "../errors.js";
import { bytesToHex, fieldToBe32, hexToBytes, utf8 } from "./field.js";
import { generateCurveKeyPair } from "./stealth.js";
import { openWithSecretKey, sealForPublicKey, type SealedBlob } from "./encryption.js";
import { regulatorEncryptionKey } from "./stealth.js";

export interface RegulatorScope {
  purpose: string;
  canDecryptAmounts: boolean;
  canDecryptCounterparties: boolean;
}

/**
 * A regulator view capability is a signed encryption key, not an encoded label.
 * The private scalar is returned once at issuance. Notes are sealed to the
 * capability public key with HKDF(ECDH) and AES-GCM associated data bound to
 * the scope, so a key issued for one scope cannot open another scope's notes.
 */
export interface RegulatorCapability {
  regulatorId: string;
  scope: RegulatorScope;
  scopeHash: string;
  expiresAt: number;
  encryptionPublicKey: Uint8Array;
  issuerSignature: Uint8Array;
}

export interface RegulatorPlaintext {
  value: bigint;
  blinding: bigint;
  rho: bigint;
  assetId: bigint;
  memo: string;
}

export function canonicalScope(scope: RegulatorScope): string {
  return JSON.stringify({
    canDecryptAmounts: scope.canDecryptAmounts,
    canDecryptCounterparties: scope.canDecryptCounterparties,
    purpose: scope.purpose,
  });
}

export function scopeHash(scope: RegulatorScope): string {
  return bytesToHex(sha256(utf8(canonicalScope(scope))));
}

function signingBytes(capability: Omit<RegulatorCapability, "issuerSignature">): Buffer {
  return Buffer.concat([
    utf8("shade.regulator.v1\0"),
    utf8(capability.regulatorId),
    utf8("\0"),
    hexToBytes(capability.scopeHash),
    fieldToBe32(BigInt(capability.expiresAt)),
    capability.encryptionPublicKey,
    utf8(canonicalScope(capability.scope)),
  ]);
}

export function issueRegulatorCapability(params: {
  regulatorId: string;
  scope: RegulatorScope;
  expiresAt: number;
  issuerPrivateKey: KeyObject;
}): { capability: RegulatorCapability; privateKey: Uint8Array } {
  if (!params.regulatorId) throw new Error("regulator id is required");
  if (!Number.isInteger(params.expiresAt) || params.expiresAt < 0) {
    throw new Error("regulator capability expiry is invalid");
  }
  const encryption = generateCurveKeyPair();
  const unsigned = {
    regulatorId: params.regulatorId,
    scope: params.scope,
    scopeHash: scopeHash(params.scope),
    expiresAt: params.expiresAt,
    encryptionPublicKey: encryption.publicKey,
  };
  const issuerSignature = sign(null, signingBytes(unsigned), params.issuerPrivateKey);
  return {
    capability: { ...unsigned, issuerSignature },
    privateKey: encryption.secretKey,
  };
}

export function verifyRegulatorCapability(
  capability: RegulatorCapability,
  issuerPublicKey: KeyObject,
  now: number,
): void {
  if (capability.scopeHash !== scopeHash(capability.scope)) {
    throw new Error("regulator scope hash does not match the scope");
  }
  const unsigned = {
    regulatorId: capability.regulatorId,
    scope: capability.scope,
    scopeHash: capability.scopeHash,
    expiresAt: capability.expiresAt,
    encryptionPublicKey: capability.encryptionPublicKey,
  };
  const ok = verify(null, signingBytes(unsigned), issuerPublicKey, capability.issuerSignature);
  if (!ok) throw new Error("regulator capability signature is invalid");
  if (now >= capability.expiresAt) throw new Error("regulator capability is expired");
}

function regulatorAad(capability: RegulatorCapability, commitment: bigint): Uint8Array {
  return utf8(
    `shade.regulator.v1|${capability.scopeHash}|${capability.regulatorId}|${capability.expiresAt}|${commitment.toString()}`,
  );
}

function redact(plaintext: RegulatorPlaintext, scope: RegulatorScope): RegulatorPlaintext {
  return {
    value: scope.canDecryptAmounts ? plaintext.value : 0n,
    blinding: scope.canDecryptAmounts ? plaintext.blinding : 0n,
    rho: plaintext.rho,
    assetId: plaintext.assetId,
    memo: scope.canDecryptCounterparties ? plaintext.memo : "",
  };
}

function encode(plaintext: RegulatorPlaintext): Uint8Array {
  return utf8(
    JSON.stringify({
      assetId: plaintext.assetId.toString(),
      blinding: plaintext.blinding.toString(),
      memo: plaintext.memo,
      rho: plaintext.rho.toString(),
      value: plaintext.value.toString(),
    }),
  );
}

function decode(bytes: Uint8Array): RegulatorPlaintext {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
    assetId: string;
    blinding: string;
    memo: string;
    rho: string;
    value: string;
  };
  return {
    assetId: BigInt(parsed.assetId),
    blinding: BigInt(parsed.blinding),
    memo: parsed.memo,
    rho: BigInt(parsed.rho),
    value: BigInt(parsed.value),
  };
}

export function sealForRegulator(params: {
  plaintext: RegulatorPlaintext;
  capability: RegulatorCapability;
  issuerPublicKey: KeyObject;
  commitment: bigint;
  now: number;
}): SealedBlob {
  verifyRegulatorCapability(params.capability, params.issuerPublicKey, params.now);
  const body = redact(params.plaintext, params.capability.scope);
  return sealForPublicKey(
    params.capability.encryptionPublicKey,
    encode(body),
    regulatorAad(params.capability, params.commitment),
    regulatorEncryptionKey,
  );
}

export function openAsRegulator(params: {
  blob: SealedBlob;
  capability: RegulatorCapability;
  privateKey: Uint8Array;
  issuerPublicKey: KeyObject;
  commitment: bigint;
  now: number;
}): RegulatorPlaintext {
  verifyRegulatorCapability(params.capability, params.issuerPublicKey, params.now);
  try {
    const bytes = openWithSecretKey(
      params.privateKey,
      params.blob,
      regulatorAad(params.capability, params.commitment),
      regulatorEncryptionKey,
    );
    return decode(bytes);
  } catch (error) {
    if (error instanceof DecryptionError) throw error;
    throw new DecryptionError();
  }
}

/** Fingerprint helper used by tests to show a capability is not a label encoding. */
export function capabilityFingerprint(capability: RegulatorCapability): string {
  return createHash("sha256").update(capability.encryptionPublicKey).digest("hex");
}
