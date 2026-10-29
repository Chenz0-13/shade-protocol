import { ASSET_BASE, ASSET_QUOTE, TREE_DEPTH } from "../constants.js";
import { DoubleSpendError } from "../errors.js";
import { generateCurveKeyPair } from "../crypto/stealth.js";
import { NullifierSet } from "../crypto/NullifierSet.js";
import type { MatchResult, ShieldedNote } from "../crypto/primitives.js";
import { MerkleTree } from "../merkle/MerkleTree.js";
import { ShieldedTransferProver } from "../proof/ShieldedTransferProver.js";
import type { TransferOutput } from "../proof/witness.js";
import { checkedOrder, openOrder, type OpenOrder, type OrderDraft } from "./order.js";
import { asBuySell, createOutputNote, planExecution, type OutputNote } from "./settlement.js";

/**
 * Operator matching engine.
 *
 * Orders are sealed to the operator view key. The operator decrypts them,
 * checks the note opening, and builds settlement proofs. That means this
 * process learns spending keys for escrowed notes. It is a devnet matcher,
 * not a blind public mempool and not a custody design for other people's funds.
 *
 * Settlement spends each escrow with the shielded-transfer circuit:
 * one output pays the counterparty and the other returns change. Each order
 * is matched at most once. Nullifiers are marked spent only after both
 * proofs verify.
 */
export class DarkPool {
  private readonly orders = new Map<string, OpenOrder>();
  private readonly reserved = new Set<string>();

  private constructor(
    private readonly prover: ShieldedTransferProver,
    private readonly tree: MerkleTree,
    private readonly nullifiers: NullifierSet,
    private readonly operatorViewPrivateKey: Uint8Array,
    readonly operatorViewPublicKey: Uint8Array,
  ) {}

  static open(prover: ShieldedTransferProver, depth: number = TREE_DEPTH): DarkPool {
    const operator = generateCurveKeyPair();
    return new DarkPool(
      prover,
      MerkleTree.empty(depth),
      new NullifierSet(),
      operator.secretKey,
      operator.publicKey,
    );
  }

  get root(): bigint {
    return this.tree.root();
  }

  get pendingCount(): number {
    return this.orders.size;
  }

  isSpent(nullifier: bigint): boolean {
    return this.nullifiers.isSpent(nullifier);
  }

  submitOrder(sealed: Uint8Array): { orderId: string; leafIndex: number } {
    const draft = openOrder(this.operatorViewPrivateKey, sealed);
    const leafIndex = this.tree.size;
    const order = checkedOrder(draft, leafIndex);
    const key = order.nullifier.toString();
    if (this.nullifiers.isSpent(key) || this.reserved.has(key)) throw new DoubleSpendError();
    const inserted = this.tree.insert(order.commitment);
    if (inserted !== leafIndex) throw new Error("commitment index drifted");
    this.orders.set(order.id, order);
    this.reserved.add(key);
    return { orderId: order.id, leafIndex };
  }

  async matchOrders(): Promise<MatchResult[]> {
    const open = [...this.orders.values()];
    const used = new Set<string>();
    const results: MatchResult[] = [];
    for (let i = 0; i < open.length; i += 1) {
      const left = open[i]!;
      if (used.has(left.id)) continue;
      for (let j = i + 1; j < open.length; j += 1) {
        const right = open[j]!;
        if (used.has(right.id)) continue;
        const pair = asBuySell(left, right);
        if (!pair) continue;
        const plan = planExecution(pair.buy, pair.sell);
        if (!plan) continue;
        results.push(await this.settle(pair.buy, pair.sell, plan));
        used.add(pair.buy.id);
        used.add(pair.sell.id);
        break;
      }
    }
    return results;
  }

  private async settle(
    buy: OpenOrder,
    sell: OpenOrder,
    plan: NonNullable<ReturnType<typeof planExecution>>,
  ): Promise<MatchResult> {
    const sellerPayment = createOutputNote({
      value: plan.filled,
      assetId: ASSET_BASE,
      recipient: buy.identity,
      memo: "base fill",
    });
    const sellerChange = createOutputNote({
      value: plan.sellerChange,
      assetId: ASSET_BASE,
      recipient: sell.identity,
      memo: "base change",
    });
    const buyerPayment = createOutputNote({
      value: plan.quotePaid,
      assetId: ASSET_QUOTE,
      recipient: sell.identity,
      memo: "quote fill",
    });
    const buyerChange = createOutputNote({
      value: plan.buyerChange,
      assetId: ASSET_QUOTE,
      recipient: buy.identity,
      memo: "quote change",
    });

    const root = this.tree.root();
    const sellProof = await this.proveSpend(sell, root, sellerPayment, sellerChange);
    const buyProof = await this.proveSpend(buy, root, buyerPayment, buyerChange);
    if (!(await this.prover.verify(sellProof.proof, sellProof.publicSignals))) {
      throw new Error("sell settlement proof failed verification");
    }
    if (!(await this.prover.verify(buyProof.proof, buyProof.publicSignals))) {
      throw new Error("buy settlement proof failed verification");
    }

    const outputs = [sellerPayment, sellerChange, buyerPayment, buyerChange];
    const notes: ShieldedNote[] = outputs.map((output) => {
      const leafIndex = this.tree.insert(output.commitment);
      return toShieldedNote(output, leafIndex);
    });
    this.nullifiers.spend(sell.nullifier);
    this.nullifiers.spend(buy.nullifier);
    this.reserved.delete(sell.nullifier.toString());
    this.reserved.delete(buy.nullifier.toString());
    this.orders.delete(sell.id);
    this.orders.delete(buy.id);

    return {
      buyNullifier: buy.nullifier,
      sellNullifier: sell.nullifier,
      proofs: [sellProof, buyProof],
      outputNotes: notes,
    };
  }

  private async proveSpend(
    order: OpenOrder,
    root: bigint,
    out1: OutputNote,
    out2: OutputNote,
  ) {
    const proofData = this.tree.getProof(order.leafIndex);
    if (proofData.root !== root || !this.tree.verify(order.commitment, proofData, root)) {
      throw new Error("escrow Merkle proof does not match the current root");
    }
    return this.prover.prove({
      root,
      spendingKey: order.spendingKey,
      valueIn: order.value,
      blindingIn: order.blinding,
      rhoIn: order.rho,
      assetIn: order.assetId,
      pathElements: proofData.pathElements,
      pathIndices: proofData.pathIndices,
      fee: 0n,
      out1: toTransferOutput(out1),
      out2: toTransferOutput(out2),
    });
  }
}

function toTransferOutput(note: OutputNote): TransferOutput {
  return {
    value: note.value,
    blinding: note.blinding,
    rho: note.rho,
    ownerPub: note.ownerPub,
    assetId: note.assetId,
  };
}

function toShieldedNote(note: OutputNote, leafIndex: number): ShieldedNote {
  return {
    commitment: note.commitment,
    nullifier: null,
    encryptedValue: note.encryptedValue,
    stealthAddress: note.stealthAddress,
    assetId: note.assetId,
    leafIndex,
  };
}

export type { OrderDraft };
