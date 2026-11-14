import { fieldToBe32, utf8 } from "../core/crypto/field.js";
import { generateCurveKeyPair, noteEncryptionKey, sharedSecret } from "../core/crypto/stealth.js";
import { bytesToBase64Url, base64UrlToBytes, concatBytes, copyBytes } from "./bytes.js";
import { VaultError } from "./vault.js";

const PREFIX = "gift1";
const GIFT_AAD = utf8("shade.gift.v1");

export interface NoteGift {
  v: 1;
  chainKey: string;
  commitment: string;
  value: string;
  blinding: string;
  rho: string;
  assetId: string;
  ownerPub: string;
  memo: string;
}

/** Associated data for a gift. Matches the byte layout the SDK can open. */
export function giftAad(): Uint8Array {
  return GIFT_AAD;
}

/**
 * Associated data the on-chain note format uses. Exposed so tests can
 * compare it with `noteAad` from the SDK.
 */
export function protocolNoteAad(commitment: bigint): Uint8Array {
  return concatBytes([utf8("shade.note.v1|"), fieldToBe32(commitment)]);
}

export async function sealForViewKey(
  viewPublicKey: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const ephemeral = generateCurveKeyPair();
  const keyBytes = noteEncryptionKey(sharedSecret(ephemeral.secretKey, viewPublicKey));
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cryptoKey = await crypto.subtle.importKey("raw", copyBytes(keyBytes), "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: copyBytes(iv), additionalData: copyBytes(aad) },
      cryptoKey,
      copyBytes(plaintext),
    ),
  );
  if (sealed.length < 16) throw new VaultError("Could not seal this note.");
  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  return concatBytes([Uint8Array.of(1), ephemeral.publicKey, iv, tag, ciphertext]);
}

export async function openForViewKey(
  viewPrivateKey: Uint8Array,
  blob: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (blob.length < 1 + 33 + 12 + 16 || blob[0] !== 1) throw new VaultError("Could not open this note.");
  const ephemeralPublicKey = blob.subarray(1, 34);
  const iv = blob.subarray(34, 46);
  const tag = blob.subarray(46, 62);
  const ciphertext = blob.subarray(62);
  const keyBytes = noteEncryptionKey(sharedSecret(viewPrivateKey, ephemeralPublicKey));
  const cryptoKey = await crypto.subtle.importKey("raw", copyBytes(keyBytes), "AES-GCM", false, ["decrypt"]);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: copyBytes(iv), additionalData: copyBytes(aad) },
        cryptoKey,
        copyBytes(concatBytes([ciphertext, tag])),
      ),
    );
  } catch {
    throw new VaultError("Could not open this note with the unlocked view key.");
  }
}

export async function sealNoteGift(viewPublicKey: Uint8Array, gift: NoteGift): Promise<string> {
  const bytes = await sealForViewKey(viewPublicKey, new TextEncoder().encode(JSON.stringify(gift)), giftAad());
  return PREFIX + bytesToBase64Url(bytes);
}

export async function openNoteGift(viewPrivateKey: Uint8Array, gift: string): Promise<NoteGift> {
  const trimmed = gift.trim();
  if (!trimmed.startsWith(PREFIX)) throw new VaultError("Paste a private note gift. It starts with gift1.");
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(trimmed.slice(PREFIX.length));
  } catch {
    throw new VaultError("That private note gift could not be read.");
  }
  const plain = await openForViewKey(viewPrivateKey, bytes, giftAad());
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new VaultError("That private note gift could not be read.");
  }
  if (typeof parsed !== "object" || parsed === null) throw new VaultError("That private note gift could not be read.");
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1) throw new VaultError("That private note gift could not be read.");
  const fields = ["chainKey", "commitment", "value", "blinding", "rho", "assetId", "ownerPub", "memo"] as const;
  const note = { v: 1 as const } as NoteGift;
  for (const field of fields) {
    if (typeof record[field] !== "string" || (record[field] as string).length === 0 && field !== "memo") {
      throw new VaultError("That private note gift could not be read.");
    }
    note[field] = record[field] as string;
  }
  if (typeof record.memo !== "string") throw new VaultError("That private note gift could not be read.");
  note.memo = record.memo;
  return note;
}
