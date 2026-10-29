import { ASSET_BASE, ASSET_QUOTE, MAX_VALUE, SIDE_BUY, SIDE_SELL } from "../constants.js";
import { utf8 } from "../crypto/field.js";
import { noteCommitment, noteNullifier, orderBinding, ownerAddress } from "../crypto/note.js";
import { openWithSecretKey, parseSealed, sealForPublicKey, serializeSealed } from "../crypto/encryption.js";
import type { PublicIdentity } from "../crypto/keys.js";
import { assertValue } from "../crypto/field.js";

export interface OrderDraft {
  side: "buy" | "sell";
  amount: bigint;
  priceMin: bigint;
  priceMax: bigint;
  value: bigint;
  blinding: bigint;
  rho: bigint;
  assetId: bigint;
  spendingKey: bigint;
  ownerPub: bigint;
  viewPublicKey: Uint8Array;
  spendPublicKey: Uint8Array;
}

export interface OpenOrder extends OrderDraft {
  id: string;
  commitment: bigint;
  nullifier: bigint;
  binding: bigint;
  leafIndex: number;
  identity: PublicIdentity;
}

const ORDER_AAD = utf8("shade.order.v1");

export function sealOrder(operatorViewPublicKey: Uint8Array, draft: OrderDraft): Buffer {
  const plaintext = utf8(
    JSON.stringify({
      amount: draft.amount.toString(),
      assetId: draft.assetId.toString(),
      blinding: draft.blinding.toString(),
      ownerPub: draft.ownerPub.toString(),
      priceMax: draft.priceMax.toString(),
      priceMin: draft.priceMin.toString(),
      rho: draft.rho.toString(),
      side: draft.side,
      spendPublicKey: Buffer.from(draft.spendPublicKey).toString("hex"),
      spendingKey: draft.spendingKey.toString(),
      value: draft.value.toString(),
      viewPublicKey: Buffer.from(draft.viewPublicKey).toString("hex"),
    }),
  );
  return serializeSealed(sealForPublicKey(operatorViewPublicKey, plaintext, ORDER_AAD));
}

export function openOrder(operatorViewPrivateKey: Uint8Array, sealed: Uint8Array): OrderDraft {
  const bytes = openWithSecretKey(operatorViewPrivateKey, parseSealed(sealed), ORDER_AAD);
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
    amount: string;
    assetId: string;
    blinding: string;
    ownerPub: string;
    priceMax: string;
    priceMin: string;
    rho: string;
    side: string;
    spendPublicKey: string;
    spendingKey: string;
    value: string;
    viewPublicKey: string;
  };
  if (parsed.side !== "buy" && parsed.side !== "sell") {
    throw new Error("order side is invalid");
  }
  return {
    side: parsed.side,
    amount: BigInt(parsed.amount),
    priceMin: BigInt(parsed.priceMin),
    priceMax: BigInt(parsed.priceMax),
    value: BigInt(parsed.value),
    blinding: BigInt(parsed.blinding),
    rho: BigInt(parsed.rho),
    assetId: BigInt(parsed.assetId),
    spendingKey: BigInt(parsed.spendingKey),
    ownerPub: BigInt(parsed.ownerPub),
    viewPublicKey: Buffer.from(parsed.viewPublicKey, "hex"),
    spendPublicKey: Buffer.from(parsed.spendPublicKey, "hex"),
  };
}

export function checkedOrder(draft: OrderDraft, leafIndex: number): OpenOrder {
  if (draft.side !== "buy" && draft.side !== "sell") throw new Error("order side is invalid");
  assertValue("amount", draft.amount);
  assertValue("priceMin", draft.priceMin);
  assertValue("priceMax", draft.priceMax);
  assertValue("value", draft.value);
  if (draft.amount === 0n) throw new Error("order amount must be positive");
  if (draft.priceMin <= 0n || draft.priceMin > draft.priceMax) {
    throw new Error("order price range is invalid");
  }
  const quoteEscrow = draft.amount * draft.priceMax;
  if (quoteEscrow > MAX_VALUE) throw new Error("quote escrow exceeds the value range");
  if (draft.side === "sell") {
    if (draft.assetId !== ASSET_BASE || draft.value !== draft.amount) {
      throw new Error("sell order must escrow its base amount");
    }
  } else if (draft.assetId !== ASSET_QUOTE || draft.value !== quoteEscrow) {
    throw new Error("buy order must escrow amount * max price of the quote asset");
  }
  if (ownerAddress(draft.spendingKey) !== draft.ownerPub) {
    throw new Error("owner public key does not match the spending key");
  }
  const commitment = noteCommitment({
    value: draft.value,
    blinding: draft.blinding,
    rho: draft.rho,
    ownerPub: draft.ownerPub,
    assetId: draft.assetId,
  });
  const nullifier = noteNullifier(draft.spendingKey, draft.rho);
  const side = draft.side === "buy" ? SIDE_BUY : SIDE_SELL;
  const binding = orderBinding({
    noteCommitment: commitment,
    side,
    priceMin: draft.priceMin,
    priceMax: draft.priceMax,
    amount: draft.amount,
  });
  return {
    ...draft,
    id: nullifier.toString(16),
    commitment,
    nullifier,
    binding,
    leafIndex,
    identity: {
      ownerPub: draft.ownerPub,
      viewPublicKey: draft.viewPublicKey,
      spendPublicKey: draft.spendPublicKey,
    },
  };
}
