import { CryptoEngine } from "../core/crypto/CryptoEngine.js";
import { DarkPool } from "../core/pool/DarkPool.js";
import { ZKComplianceLayer } from "../core/compliance/ZKComplianceLayer.js";

export type SupportedChain = "solana" | "near" | "canton" | "robinhood";

export interface ShadeConfig {
  chains: SupportedChain[];
  solanaRpc?: string;
  nearNetwork?: string;
  cantonHost?: string;
  robinhoodApiKey?: string;
  zkeyPath?: string;
  wasmPath?: string;
}

export class ShadeClient {
  private crypto: CryptoEngine;
  private pool: DarkPool;
  private compliance: ZKComplianceLayer;
  private config: ShadeConfig;

  constructor(config: ShadeConfig) {
    this.config = config;
    this.crypto = new CryptoEngine();
    this.pool = new DarkPool();
    this.compliance = new ZKComplianceLayer();
  }

  async init(): Promise<void> {
    await this.crypto.init();
    await this.pool.init();
    await this.compliance.init();
    console.log("Shade Protocol initialized on:", this.config.chains);
  }

  async shieldedTransfer(params: {
    chain: SupportedChain;
    amount: bigint;
    recipientPubKey: Uint8Array;
    senderSecret: Uint8Array;
    merkleRoot: bigint;
    merkleProof: bigint[];
    merklePathIndices: number[];
  }): Promise<{ txHash: string; outputNote: any }> {
    const outputNote = await this.crypto.buildNote(
      params.amount,
      params.recipientPubKey,
      params.senderSecret
    );

    const { proof, publicSignals } = await this.generateTransferProof(
      params.amount,
      params.senderSecret,
      params.recipientPubKey,
      params.merkleRoot,
      params.merkleProof,
      params.merklePathIndices,
      outputNote.commitment,
      0n
    );

    let txHash = "pending";
    switch (params.chain) {
      case "solana":
        txHash = await this.submitToSolana(outputNote, proof, publicSignals);
        break;
      case "near":
        txHash = await this.submitToNear(outputNote, proof, publicSignals);
        break;
      case "canton":
        txHash = await this.submitToCanton(outputNote, proof);
        break;
      case "robinhood":
        txHash = await this.submitToRobinhood(outputNote, proof);
        break;
    }

    return { txHash, outputNote };
  }

  async submitDarkOrder(params: {
    chain: SupportedChain;
    encryptedAmount: Buffer;
    encryptedDirection: Buffer;
    priceRange: [bigint, bigint];
    orderSecret: Uint8Array;
  }): Promise<{ orderId: string }> {
    const commitment = await this.crypto.buildNote(
      0n,
      params.orderSecret,
      params.orderSecret
    );

    const order = {
      encryptedAmount: params.encryptedAmount,
      encryptedDirection: params.encryptedDirection,
      commitment: commitment.commitment,
      priceRange: params.priceRange,
      timestamp: Date.now(),
      nullifier: commitment.nullifier,
    };

    const result = await this.pool.submitOrder(order, {}, {});
    return { orderId: result.orderId };
  }

  private async generateTransferProof(
    amount: bigint,
    secret: Uint8Array,
    recipientPubKey: Uint8Array,
    merkleRoot: bigint,
    merkleProof: bigint[],
    merklePathIndices: number[],
    outputCommitment: bigint,
    fee: bigint
  ): Promise<{ proof: Record<string, unknown>; publicSignals: string[] }> {
    return {
      proof: { protocol: "groth16", mock: true },
      publicSignals: [
        merkleRoot.toString(),
        outputCommitment.toString(),
        amount.toString(),
        fee.toString(),
      ],
    };
  }

  private async submitToSolana(
    outputNote: unknown,
    proof: Record<string, unknown>,
    publicSignals: string[]
  ): Promise<string> {
    return `solana:${Buffer.from(JSON.stringify({ outputNote, proof, publicSignals })).toString("base64")}`;
  }

  private async submitToNear(
    outputNote: unknown,
    proof: Record<string, unknown>,
    publicSignals: string[]
  ): Promise<string> {
    return `near:${Buffer.from(JSON.stringify({ outputNote, proof, publicSignals })).toString("base64")}`;
  }

  private async submitToCanton(outputNote: unknown, proof: Record<string, unknown>): Promise<string> {
    return `canton:${Buffer.from(JSON.stringify({ outputNote, proof })).toString("base64")}`;
  }

  private async submitToRobinhood(outputNote: unknown, proof: Record<string, unknown>): Promise<string> {
    return `robinhood:${Buffer.from(JSON.stringify({ outputNote, proof })).toString("base64")}`;
  }
}
