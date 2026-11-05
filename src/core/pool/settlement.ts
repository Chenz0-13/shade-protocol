import { randomNonZeroField } from "../crypto/field.js";
import type { PublicIdentity } from "../crypto/keys.js";
import { noteAad, sealForPublicKey, serializeSealed } from "../crypto/encryption.js";
import { noteCommitment } from "../crypto/note.js";
import { deriveStealthAddress } from "../crypto/stealth.js";
import { encodeNotePlaintext } from "./plaintext.js";
import type { OpenOrder } from "./order.js";

export interface ExecutionPlan {
  price: bigint;
  filled: bigint;
  quotePaid: bigint;
  sellerChange: bigint;
  buyerChange: bigint;
}

export interface OutputNote {
  commitment: bigint;
  encryptedValue: Buffer;
  stealthAddress: string;
  assetId: bigint;
  value: bigint;
  blinding: bigint;
  rho: bigint;
  ownerPub: bigint;
  recipient: PublicIdentity;
}

/**
 * Price is the lower edge of the overlap, which is the best price inside
 * both ranges for the buyer. Returns null when the sides or ranges disagree.
 * A buy never matches another buy.
 */
export function planExecution(buy: OpenOrder, sell: OpenOrder): ExecutionPlan | null {
  if (buy.side !== "buy" || sell.side !== "sell") return null;
  const low = buy.priceMin > sell.priceMin ? buy.priceMin : sell.priceMin;
  const high = buy.priceMax < sell.priceMax ? buy.priceMax : sell.priceMax;
  if (low > high) return null;
  const filled = buy.amount < sell.amount ? buy.amount : sell.amount;
  if (filled === 0n) return null;
  const quotePaid = filled * low;
  const buyerEscrow = buy.amount * buy.priceMax;
  if (quotePaid > buyerEscrow) return null;
  return {
    price: low,
    filled,
    quotePaid,
    sellerChange: sell.amount - filled,
    buyerChange: buyerEscrow - quotePaid,
  };
}

export function asBuySell(left: OpenOrder, right: OpenOrder): { buy: OpenOrder; sell: OpenOrder } | null {
  if (left.side === "buy" && right.side === "sell") return { buy: left, sell: right };
  if (left.side === "sell" && right.side === "buy") return { buy: right, sell: left };
  return null;
}

export function createOutputNote(params: {
  value: bigint;
  assetId: bigint;
  recipient: PublicIdentity;
  memo: string;
}): OutputNote {
  const blinding = randomNonZeroField();
  const rho = randomNonZeroField();
  const commitment = noteCommitment({
    value: params.value,
    blinding,
    rho,
    ownerPub: params.recipient.ownerPub,
    assetId: params.assetId,
  });
  const stealth = deriveStealthAddress(params.recipient.spendPublicKey, params.recipient.viewPublicKey);
  const plaintext = encodeNotePlaintext({
    value: params.value,
    blinding,
    rho,
    assetId: params.assetId,
    memo: params.memo,
  });
  const encryptedValue = serializeSealed(
    sealForPublicKey(params.recipient.viewPublicKey, plaintext, noteAad(commitment), undefined, {
      secretKey: stealth.ephemeralSecretKey,
      publicKey: stealth.ephemeralPublicKey,
    }),
  );
  return {
    commitment,
    encryptedValue,
    stealthAddress: Buffer.from(stealth.stealthPublicKey).toString("hex"),
    assetId: params.assetId,
    value: params.value,
    blinding,
    rho,
    ownerPub: params.recipient.ownerPub,
    recipient: params.recipient,
  };
}
