import { utf8 } from "../crypto/field.js";
import type { NotePlaintext } from "../crypto/primitives.js";

export function encodeNotePlaintext(note: NotePlaintext): Uint8Array {
  return utf8(
    JSON.stringify({
      assetId: note.assetId.toString(),
      blinding: note.blinding.toString(),
      memo: note.memo,
      rho: note.rho.toString(),
      value: note.value.toString(),
    }),
  );
}

export function decodeNotePlaintext(bytes: Uint8Array): NotePlaintext {
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
