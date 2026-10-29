import { CryptoEngine } from "../crypto/CryptoEngine.js";
import { EncryptedOrder, MatchResult, ShieldedNote } from "../crypto/primitives.js";
import { MerkleTree } from "../utils/MerkleTree.js";

export class DarkPool {
  private commitmentTree: MerkleTree;
  private nullifierSet: Set<string>;
  private pendingOrders: Map<string, EncryptedOrder>;
  private crypto: CryptoEngine;

  constructor(treeDepth: number = 20) {
    this.commitmentTree = new MerkleTree(treeDepth);
    this.nullifierSet = new Set();
    this.pendingOrders = new Map();
    this.crypto = new CryptoEngine();
  }

  async init(): Promise<void> {
    await this.crypto.init();
  }

  async submitOrder(
    encryptedOrder: EncryptedOrder,
    proof: Record<string, unknown>,
    verificationKey: Record<string, unknown>
  ): Promise<{ orderId: string; leafIndex: number }> {
    const publicSignals = [
      encryptedOrder.commitment.toString(),
      encryptedOrder.nullifier.toString(),
    ];

    const isValid = await this.crypto.verifyProof(proof, publicSignals, verificationKey);
    if (!isValid) {
      throw new Error("Invalid order proof");
    }

    const nullKey = encryptedOrder.nullifier.toString();
    if (this.nullifierSet.has(nullKey)) {
      throw new Error("Order nullifier already spent");
    }

    const leafIndex = await this.commitmentTree.insert(encryptedOrder.commitment);
    const orderId = `order_${encryptedOrder.commitment.toString(16).slice(0, 16)}`;
    this.pendingOrders.set(orderId, encryptedOrder);

    return { orderId, leafIndex };
  }

  async matchOrders(): Promise<MatchResult[]> {
    const results: MatchResult[] = [];
    const orders = Array.from(this.pendingOrders.values());

    for (let i = 0; i < orders.length; i++) {
      for (let j = i + 1; j < orders.length; j++) {
        const buy = orders[i];
        const sell = orders[j];

        if (this.priceRangesOverlap(buy.priceRange, sell.priceRange)) {
          const match = await this.settleMatch(buy, sell);
          results.push(match);

          this.nullifierSet.add(buy.nullifier.toString());
          this.nullifierSet.add(sell.nullifier.toString());

          this.pendingOrders.delete(
            `order_${buy.commitment.toString(16).slice(0, 16)}`
          );
          this.pendingOrders.delete(
            `order_${sell.commitment.toString(16).slice(0, 16)}`
          );
        }
      }
    }

    return results;
  }

  private async settleMatch(
    buy: EncryptedOrder,
    sell: EncryptedOrder
  ): Promise<MatchResult> {
    const proof = await this.generateSettlementProof(buy, sell);
    const outputNotes: ShieldedNote[] = [];

    return {
      buyNullifier: buy.nullifier,
      sellNullifier: sell.nullifier,
      proof,
      outputNotes,
    };
  }

  private priceRangesOverlap(a: [bigint, bigint], b: [bigint, bigint]): boolean {
    return a[0] <= b[1] && b[0] <= a[1];
  }

  private async generateSettlementProof(
    buy: EncryptedOrder,
    sell: EncryptedOrder
  ): Promise<Record<string, unknown>> {
    return {
      pi_a: [],
      pi_b: [],
      pi_c: [],
      protocol: "groth16",
      buy: buy.commitment.toString(),
      sell: sell.commitment.toString(),
    };
  }

  getAnonymizedDepth(): { bidDepth: number; askDepth: number } {
    const orders = Array.from(this.pendingOrders.values());
    return {
      bidDepth: orders.filter((o) => o.priceRange[0] > 0n).length,
      askDepth: orders.filter((o) => o.priceRange[1] > 0n).length,
    };
  }
}
