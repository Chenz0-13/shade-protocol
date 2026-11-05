import { createDecipheriv } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { describe, expect, it } from "vitest";
import { noteAad, openWithSecretKey, parseSealed } from "../src/core/crypto/encryption.js";
import { randomNonZeroField } from "../src/core/crypto/field.js";
import { generatePrivacyKeys } from "../src/core/crypto/keys.js";
import { commitmentOpens, noteCommitment, noteNullifier } from "../src/core/crypto/note.js";
import {
  issueRegulatorCapability,
  openAsRegulator,
  sealForRegulator,
} from "../src/core/crypto/regulator.js";
import {
  deriveStealthAddress,
  deriveStealthPrivateKey,
  noteEncryptionKey,
  recognizeStealthAddress,
  sharedSecret,
} from "../src/core/crypto/stealth.js";
import { buildOutgoingNote, readNote } from "../src/core/notes/outgoing.js";
import { ASSET_BASE } from "../src/core/constants.js";
import { DecryptionError } from "../src/core/errors.js";

describe("commitments and nullifiers", () => {
  it("hides the value and binds the opening", () => {
    const owner = randomNonZeroField();
    const rho = randomNonZeroField();
    const first = noteCommitment({
      value: 50n,
      blinding: randomNonZeroField(),
      rho,
      ownerPub: owner,
      assetId: ASSET_BASE,
    });
    const second = noteCommitment({
      value: 50n,
      blinding: randomNonZeroField(),
      rho,
      ownerPub: owner,
      assetId: ASSET_BASE,
    });
    expect(first).not.toBe(second);
    expect(first).not.toBe(50n);
    const opening = {
      value: 50n,
      blinding: randomNonZeroField(),
      rho,
      ownerPub: owner,
      assetId: ASSET_BASE,
    };
    const commitment = noteCommitment(opening);
    expect(commitmentOpens(commitment, opening)).toBe(true);
    expect(commitmentOpens(commitment, { ...opening, value: 51n })).toBe(false);
  });

  it("derives a nullifier unique to the note", () => {
    const key = randomNonZeroField();
    const rho = randomNonZeroField();
    expect(noteNullifier(key, rho)).toBe(noteNullifier(key, rho));
    expect(noteNullifier(key, rho)).not.toBe(noteNullifier(key, randomNonZeroField()));
    expect(noteNullifier(key, rho)).not.toBe(noteNullifier(randomNonZeroField(), rho));
  });
});

describe("stealth addresses and note encryption", () => {
  it("lets the recipient recognize and spend the one-time curve key", () => {
    const recipient = generatePrivacyKeys();
    const stealth = deriveStealthAddress(recipient.spendPublicKey, recipient.viewPublicKey);
    expect(Buffer.from(stealth.stealthPublicKey).equals(Buffer.from(recipient.spendPublicKey))).toBe(false);
    expect(
      recognizeStealthAddress(
        recipient.viewPrivateKey,
        recipient.spendPublicKey,
        stealth.ephemeralPublicKey,
        stealth.stealthPublicKey,
      ),
    ).toBe(true);
    const stranger = generatePrivacyKeys();
    expect(
      recognizeStealthAddress(
        stranger.viewPrivateKey,
        recipient.spendPublicKey,
        stealth.ephemeralPublicKey,
        stealth.stealthPublicKey,
      ),
    ).toBe(false);

    const oneTime = deriveStealthPrivateKey(
      recipient.spendPrivateKey,
      recipient.viewPrivateKey,
      stealth.ephemeralPublicKey,
    );
    const point = secp256k1.getPublicKey(oneTime, true);
    expect(Buffer.from(point).equals(Buffer.from(stealth.stealthPublicKey))).toBe(true);

    const viewOnly = deriveStealthPrivateKey(
      stranger.spendPrivateKey,
      recipient.viewPrivateKey,
      stealth.ephemeralPublicKey,
    );
    expect(Buffer.from(secp256k1.getPublicKey(viewOnly, true)).equals(Buffer.from(stealth.stealthPublicKey))).toBe(
      false,
    );
  });

  it("encrypts with HKDF(ECDH) rather than the raw secret", () => {
    const sender = generatePrivacyKeys();
    const recipient = generatePrivacyKeys();
    const note = buildOutgoingNote({
      value: 25n,
      assetId: ASSET_BASE,
      recipient: {
        ownerPub: recipient.ownerPub,
        viewPublicKey: recipient.viewPublicKey,
        spendPublicKey: recipient.spendPublicKey,
      },
      memo: "payroll",
    });
    const plaintext = readNote(recipient, note);
    expect(plaintext.value).toBe(25n);
    expect(plaintext.memo).toBe("payroll");
    expect(() => readNote(sender, note)).toThrow(/stealth address/);

    const blob = parseSealed(note.encryptedValue);
    const rawKey = Buffer.alloc(32);
    rawKey.set(recipient.viewPrivateKey.subarray(0, 32));
    const decipher = createDecipheriv("aes-256-gcm", rawKey, Buffer.from(blob.iv));
    decipher.setAAD(Buffer.from(noteAad(note.commitment)));
    decipher.setAuthTag(Buffer.from(blob.tag));
    expect(() => {
      decipher.update(Buffer.from(blob.ciphertext));
      decipher.final();
    }).toThrow();

    const shared = sharedSecret(recipient.viewPrivateKey, blob.ephemeralPublicKey);
    const derived = noteEncryptionKey(shared);
    expect(Buffer.from(derived).equals(rawKey)).toBe(false);
    expect(openWithSecretKey(recipient.viewPrivateKey, blob, noteAad(note.commitment)).length).toBeGreaterThan(0);
  });
});

describe("regulator view keys", () => {
  it("decrypts only inside the signed scope and expiry", () => {
    const issuer = generateKeyPairSync("ed25519");
    const now = 1_700_000_000;
    const issued = issueRegulatorCapability({
      regulatorId: "reg-1",
      scope: { purpose: "audit", canDecryptAmounts: true, canDecryptCounterparties: false },
      expiresAt: now + 100,
      issuerPrivateKey: issuer.privateKey,
    });
    const narrow = issueRegulatorCapability({
      regulatorId: "reg-1",
      scope: { purpose: "audit", canDecryptAmounts: false, canDecryptCounterparties: false },
      expiresAt: now + 100,
      issuerPrivateKey: issuer.privateKey,
    });
    const commitment = randomNonZeroField();
    const plaintext = {
      value: 99n,
      blinding: randomNonZeroField(),
      rho: randomNonZeroField(),
      assetId: ASSET_BASE,
      memo: "alice->bob",
    };
    const sealed = sealForRegulator({
      plaintext,
      capability: issued.capability,
      issuerPublicKey: issuer.publicKey,
      commitment,
      now,
    });
    const opened = openAsRegulator({
      blob: sealed,
      capability: issued.capability,
      privateKey: issued.privateKey,
      issuerPublicKey: issuer.publicKey,
      commitment,
      now,
    });
    expect(opened.value).toBe(99n);
    expect(opened.memo).toBe("");

    const redacted = sealForRegulator({
      plaintext,
      capability: narrow.capability,
      issuerPublicKey: issuer.publicKey,
      commitment,
      now,
    });
    expect(
      openAsRegulator({
        blob: redacted,
        capability: narrow.capability,
        privateKey: narrow.privateKey,
        issuerPublicKey: issuer.publicKey,
        commitment,
        now,
      }).value,
    ).toBe(0n);

    expect(() =>
      openAsRegulator({
        blob: sealed,
        capability: narrow.capability,
        privateKey: narrow.privateKey,
        issuerPublicKey: issuer.publicKey,
        commitment,
        now,
      }),
    ).toThrow(DecryptionError);

    const tampered = { ...issued.capability, expiresAt: issued.capability.expiresAt + 1 };
    expect(() =>
      openAsRegulator({
        blob: sealed,
        capability: tampered,
        privateKey: issued.privateKey,
        issuerPublicKey: issuer.publicKey,
        commitment,
        now,
      }),
    ).toThrow(/signature/);

    expect(() =>
      openAsRegulator({
        blob: sealed,
        capability: issued.capability,
        privateKey: issued.privateKey,
        issuerPublicKey: issuer.publicKey,
        commitment,
        now: issued.capability.expiresAt,
      }),
    ).toThrow(/expired/);

    const encodedLabel = Buffer.from(`reg-1:${commitment}`).toString("base64");
    expect(Buffer.from(issued.privateKey).toString("base64")).not.toBe(encodedLabel);
  });
});
