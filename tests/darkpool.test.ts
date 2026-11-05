import { beforeAll, describe, expect, it } from "vitest";
import { ASSET_BASE, ASSET_QUOTE } from "../src/core/constants.js";
import { randomNonZeroField } from "../src/core/crypto/field.js";
import { generatePrivacyKeys, type PrivacyKeys } from "../src/core/crypto/keys.js";
import { readNote } from "../src/core/notes/outgoing.js";
import { DoubleSpendError } from "../src/core/errors.js";
import { DarkPool } from "../src/core/pool/DarkPool.js";
import { sealOrder, type OrderDraft } from "../src/core/pool/order.js";
import { asBuySell, planExecution } from "../src/core/pool/settlement.js";
import { ShieldedTransferProver } from "../src/core/proof/ShieldedTransferProver.js";

function draft(keys: PrivacyKeys, side: "buy" | "sell", amount: bigint, priceMin: bigint, priceMax: bigint): OrderDraft {
  return {
    side,
    amount,
    priceMin,
    priceMax,
    value: side === "sell" ? amount : amount * priceMax,
    blinding: randomNonZeroField(),
    rho: randomNonZeroField(),
    assetId: side === "sell" ? ASSET_BASE : ASSET_QUOTE,
    spendingKey: keys.spendingKey,
    ownerPub: keys.ownerPub,
    viewPublicKey: keys.viewPublicKey,
    spendPublicKey: keys.spendPublicKey,
  };
}

describe("dark pool", () => {
  let prover: ShieldedTransferProver;

  beforeAll(() => {
    prover = ShieldedTransferProver.load();
  });

  it("does not match two buys and rejects a forged order or a repeated nullifier", async () => {
    const pool = DarkPool.open(prover);
    const buyA = generatePrivacyKeys();
    const buyB = generatePrivacyKeys();
    pool.submitOrder(sealOrder(pool.operatorViewPublicKey, draft(buyA, "buy", 10n, 5n, 5n)));
    pool.submitOrder(sealOrder(pool.operatorViewPublicKey, draft(buyB, "buy", 10n, 5n, 5n)));
    expect(await pool.matchOrders()).toEqual([]);
    expect(asBuySell({ side: "buy" } as Parameters<typeof asBuySell>[0], { side: "buy" } as Parameters<typeof asBuySell>[1])).toBeNull();

    const sealed = sealOrder(pool.operatorViewPublicKey, draft(buyA, "buy", 3n, 4n, 4n));
    const forged = Buffer.from(sealed);
    forged[forged.length - 1] ^= 1;
    expect(() => pool.submitOrder(forged)).toThrow();
    pool.submitOrder(sealed);
    expect(() => pool.submitOrder(sealed)).toThrow(DoubleSpendError);
  });

  it("matches one counterparty, spends nullifiers, and creates output notes", async () => {
    const pool = DarkPool.open(prover);
    const sell = generatePrivacyKeys();
    const buy = generatePrivacyKeys();
    const other = generatePrivacyKeys();
    const sellDraft = draft(sell, "sell", 4n, 5n, 7n);
    const buyDraft = draft(buy, "buy", 10n, 6n, 9n);
    pool.submitOrder(sealOrder(pool.operatorViewPublicKey, sellDraft));
    pool.submitOrder(sealOrder(pool.operatorViewPublicKey, buyDraft));
    pool.submitOrder(sealOrder(pool.operatorViewPublicKey, draft(other, "buy", 10n, 6n, 9n)));

    const results = await pool.matchOrders();
    expect(results).toHaveLength(1);
    expect(pool.pendingCount).toBe(1);
    expect(pool.isSpent(results[0]!.sellNullifier)).toBe(true);
    expect(pool.isSpent(results[0]!.buyNullifier)).toBe(true);
    expect(results[0]!.outputNotes.length).toBe(4);
    for (const proof of results[0]!.proofs) {
      expect(await prover.verify(proof.proof, proof.publicSignals)).toBe(true);
    }

    const notes = results[0]!.outputNotes;
    const decrypted = [
      ...notes.map((note) => {
        try {
          return { who: "sell" as const, plain: readNote(sell, note) };
        } catch {
          return { who: "buy" as const, plain: readNote(buy, note) };
        }
      }),
    ];
    const values = (who: "buy" | "sell", asset: bigint) =>
      decrypted
        .filter((item) => item.who === who && item.plain.assetId === asset)
        .map((item) => item.plain.value)
        .sort((left, right) => (left < right ? -1 : 1));
    expect(values("buy", ASSET_BASE)).toEqual([4n]);
    expect(values("sell", ASSET_QUOTE)).toEqual([24n]);
    expect(values("buy", ASSET_QUOTE)).toEqual([66n]);
    expect(values("sell", ASSET_BASE)).toEqual([0n]);

    expect(await pool.matchOrders()).toEqual([]);
    expect(() => pool.submitOrder(sealOrder(pool.operatorViewPublicKey, sellDraft))).toThrow(DoubleSpendError);
  });

  it("plans no trade when price ranges are disjoint", () => {
    const left = draft(generatePrivacyKeys(), "buy", 1n, 1n, 2n);
    const right = draft(generatePrivacyKeys(), "sell", 1n, 3n, 4n);
    const buy = { ...left, id: "b", commitment: 1n, nullifier: 1n, binding: 1n, leafIndex: 0, identity: left };
    const sell = { ...right, id: "s", commitment: 2n, nullifier: 2n, binding: 2n, leafIndex: 1, identity: right };
    expect(planExecution(buy, sell)).toBeNull();
  });
});
