import { readNote } from "../core/notes/outgoing.js";
import type { PrivacyKeys } from "../core/crypto/keys.js";
import type { NotePlaintext } from "../core/crypto/primitives.js";
import type { OutgoingNote } from "../core/notes/outgoing.js";

export interface ScannedNote {
  commitment: bigint;
  plaintext: NotePlaintext;
}

/** Tries the view key on every encrypted output. Notes for other recipients are skipped. */
export function scanNotes(
  keys: PrivacyKeys,
  notes: ReadonlyArray<Pick<OutgoingNote, "encryptedValue" | "commitment" | "stealthAddress">>,
): ScannedNote[] {
  const found: ScannedNote[] = [];
  for (const note of notes) {
    try {
      found.push({ commitment: note.commitment, plaintext: readNote(keys, note) });
    } catch {
      continue;
    }
  }
  return found;
}
