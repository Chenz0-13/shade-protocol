import { generatePrivacyKeys, publicIdentity, type PrivacyKeys, type PublicIdentity } from "./keys.js";
import { noteCommitment, noteNullifier, ownerAddress, type NoteParts } from "./note.js";
import { buildOutgoingNote, readNote, type OutgoingNote } from "../notes/outgoing.js";
import type { NotePlaintext } from "./primitives.js";

/** Facade over the note, stealth, and commitment operations. */
export class CryptoEngine {
  generateKeys(): PrivacyKeys {
    return generatePrivacyKeys();
  }

  ownerAddress(spendingKey: bigint): bigint {
    return ownerAddress(spendingKey);
  }

  commitment(parts: NoteParts): bigint {
    return noteCommitment(parts);
  }

  nullifier(spendingKey: bigint, rho: bigint): bigint {
    return noteNullifier(spendingKey, rho);
  }

  buildNote(params: {
    value: bigint;
    assetId: bigint;
    recipient: PublicIdentity;
    spendingKey?: bigint;
    memo?: string;
  }): OutgoingNote {
    return buildOutgoingNote(params);
  }

  readNote(keys: PrivacyKeys, note: Pick<OutgoingNote, "encryptedValue" | "commitment" | "stealthAddress">): NotePlaintext {
    return readNote(keys, note);
  }

  identity(keys: PrivacyKeys): PublicIdentity {
    return publicIdentity(keys);
  }
}
