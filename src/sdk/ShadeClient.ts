import { logger } from "../core/log/logger.js";
import { ASSET_BASE, TREE_DEPTH } from "../core/constants.js";
import { DoubleSpendError } from "../core/errors.js";
import { resolveConfig, type ShadeConfig, type SupportedChain } from "../core/chain/config.js";
import { submitCanton } from "../core/chain/canton.js";
import { NearTestnetAdapter } from "../core/chain/near.js";
import { RobinhoodTestnetAdapter } from "../core/chain/robinhood.js";
import { SolanaDevnetAdapter, type ChainSubmission, type SolanaRpc } from "../core/chain/solana.js";
import {
  DevnetPermissiveScreen,
  type SanctionsScreen,
} from "../core/compliance/SanctionsScreen.js";
import {
  MemoryCredentialStore,
  type CredentialStore,
} from "../core/compliance/CredentialStore.js";
import {
  generateIssuerKeys,
  ZKComplianceLayer,
  type IssuerKeys,
} from "../core/compliance/ZKComplianceLayer.js";
import { generatePrivacyKeys, publicIdentity, type PrivacyKeys, type PublicIdentity } from "../core/crypto/keys.js";
import { NullifierSet } from "../core/crypto/NullifierSet.js";
import { noteNullifier } from "../core/crypto/note.js";
import { DarkPool } from "../core/pool/DarkPool.js";
import { sealOrder, type OrderDraft } from "../core/pool/order.js";
import { MerkleTree } from "../core/merkle/MerkleTree.js";
import { buildOutgoingNote, toShieldedNote, type OutgoingNote } from "../core/notes/outgoing.js";
import { ShieldedTransferProver } from "../core/proof/ShieldedTransferProver.js";
import type { ShieldedNote } from "../core/crypto/primitives.js";

export interface ShadeClientOptions {
  config?: Partial<ShadeConfig>;
  env?: NodeJS.ProcessEnv;
  solanaSecretKey?: Uint8Array;
  solanaRpc?: SolanaRpc;
  sanctions?: SanctionsScreen;
  credentialStore?: CredentialStore;
  issuerKeys?: IssuerKeys;
  prover?: ShieldedTransferProver;
}

export interface MintedNote {
  opening: {
    value: bigint;
    blinding: bigint;
    rho: bigint;
    assetId: bigint;
    spendingKey: bigint;
    ownerPub: bigint;
    index: number;
  };
  note: ShieldedNote;
}

/**
 * Devnet client. `init` loads the real Groth16 artifacts and refuses to
 * continue when they are missing. `mintNote` is a local devnet mint into
 * the commitment tree, not a shielded deposit from a public balance.
 */
export class ShadeClient {
  readonly config: ShadeConfig;
  readonly compliance: ZKComplianceLayer;
  private readonly solana: SolanaDevnetAdapter;
  private readonly near: NearTestnetAdapter;
  private readonly robinhood: RobinhoodTestnetAdapter;
  private prover?: ShieldedTransferProver;
  private tree?: MerkleTree;
  private nullifiers?: NullifierSet;
  private pool?: DarkPool;

  constructor(private readonly options: ShadeClientOptions = {}) {
    const resolved = resolveConfig(options.config, options.env, options.solanaSecretKey);
    this.config = resolved.config;
    const issuer = options.issuerKeys ?? generateIssuerKeys();
    this.compliance = new ZKComplianceLayer(
      options.credentialStore ?? new MemoryCredentialStore(),
      options.sanctions ?? new DevnetPermissiveScreen(),
      issuer.publicKey,
      issuer.privateKey,
    );
    this.solana = new SolanaDevnetAdapter({
      rpcUrl: resolved.config.solanaRpc,
      secretKey: resolved.solanaSecretKey,
      programId: resolved.config.solanaProgramId,
      rpc: options.solanaRpc,
    });
    this.near = new NearTestnetAdapter({
      rpcUrl: resolved.config.nearRpc,
      accountId: resolved.config.nearAccountId,
      contractId: resolved.config.nearContractId,
      secretKey: resolved.nearSecretKey,
    });
    this.robinhood = new RobinhoodTestnetAdapter({
      rpcUrl: resolved.config.robinhoodRpc,
      chainId: resolved.config.robinhoodChainId,
      pool: resolved.config.robinhoodPool as `0x${string}` | undefined,
      privateKey: resolved.robinhoodPrivateKey,
    });
  }

  async init(): Promise<void> {
    this.prover = this.options.prover ?? ShieldedTransferProver.load();
    this.tree = MerkleTree.empty(TREE_DEPTH);
    this.nullifiers = new NullifierSet();
    this.pool = DarkPool.open(this.prover);
    logger.info("shade initialized", { chains: this.config.chains });
  }

  generateKeys(): PrivacyKeys {
    return generatePrivacyKeys();
  }

  /**
   * Inserts a fresh note for `owner` into the local devnet tree.
   * This does not prove a deposit and does not move public funds.
   */
  mintNote(owner: PrivacyKeys, value: bigint, assetId: bigint = ASSET_BASE): MintedNote {
    const tree = this.requireTree();
    const outgoing = buildOutgoingNote({
      value,
      assetId,
      recipient: publicIdentity(owner),
      spendingKey: owner.spendingKey,
      memo: "devnet mint",
    });
    const index = tree.insert(outgoing.commitment);
    return {
      opening: {
        value: outgoing.value,
        blinding: outgoing.blinding,
        rho: outgoing.rho,
        assetId: outgoing.assetId,
        spendingKey: owner.spendingKey,
        ownerPub: owner.ownerPub,
        index,
      },
      note: toShieldedNote(outgoing, index),
    };
  }

  async shieldedTransfer(params: {
    chain: SupportedChain;
    owner: PrivacyKeys;
    inputIndex: number;
    valueIn: bigint;
    blindingIn: bigint;
    rhoIn: bigint;
    assetId: bigint;
    outputs: Array<{ value: bigint; recipient: PublicIdentity }>;
    fee?: bigint;
    nearRecipient?: string;
    evmRecipient?: `0x${string}`;
  }): Promise<{ signature: string; outputs: OutgoingNote[] }> {
    if (!this.config.chains.includes(params.chain)) {
      throw new Error(`chain ${params.chain} is not enabled`);
    }
    const tree = this.requireTree();
    const nullifiers = this.requireNullifiers();
    const prover = this.requireProver();
    const fee = params.fee ?? 0n;
    const nullifier = noteNullifier(params.owner.spendingKey, params.rhoIn);
    if (nullifiers.isSpent(nullifier)) throw new DoubleSpendError();

    const outputs = normalizeOutputs(params.outputs, params.assetId, params.owner);
    if (params.valueIn !== outputs[0].value + outputs[1].value + fee) {
      throw new Error("input value does not equal outputs plus fee");
    }
    const proofPath = tree.getProof(params.inputIndex);
    const proved = await prover.prove({
      root: proofPath.root,
      spendingKey: params.owner.spendingKey,
      valueIn: params.valueIn,
      blindingIn: params.blindingIn,
      rhoIn: params.rhoIn,
      assetIn: params.assetId,
      pathElements: proofPath.pathElements,
      pathIndices: proofPath.pathIndices,
      fee,
      out1: {
        value: outputs[0].value,
        blinding: outputs[0].blinding,
        rho: outputs[0].rho,
        ownerPub: outputs[0].ownerPub,
        assetId: outputs[0].assetId,
      },
      out2: {
        value: outputs[1].value,
        blinding: outputs[1].blinding,
        rho: outputs[1].rho,
        ownerPub: outputs[1].ownerPub,
        assetId: outputs[1].assetId,
      },
    });
    if (!(await prover.verify(proved.proof, proved.publicSignals))) {
      throw new Error("shielded transfer proof failed verification");
    }
    if (proved.publicSignals[1] !== nullifier.toString()) {
      throw new Error("proof nullifier does not match the spent note");
    }
    nullifiers.spend(nullifier);
    for (const output of outputs) tree.insert(output.commitment);

    const payload: ChainSubmission = {
      merkleRoot: proved.publicSignals[0]!,
      nullifier: proved.publicSignals[1]!,
      commitmentOut1: proved.publicSignals[2]!,
      commitmentOut2: proved.publicSignals[3]!,
      fee: proved.publicSignals[4]!,
      proof: proved.proof,
    };
    const signature = await this.submit(params.chain, payload, params.nearRecipient, params.evmRecipient);
    return { signature, outputs };
  }

  get darkPool(): DarkPool {
    if (!this.pool) throw new Error("call init() before using the dark pool");
    return this.pool;
  }

  sealDarkOrder(draft: OrderDraft): Buffer {
    return sealOrder(this.darkPool.operatorViewPublicKey, draft);
  }

  private async submit(
    chain: SupportedChain,
    payload: ChainSubmission,
    nearRecipient?: string,
    evmRecipient?: `0x${string}`,
  ): Promise<string> {
    switch (chain) {
      case "solana":
        return (await this.solana.submit(payload)).signature;
      case "near":
        if (!nearRecipient) throw new Error("nearRecipient is required");
        return (await this.near.shieldedTransfer(payload, nearRecipient)).hash;
      case "canton":
        return submitCanton();
      case "robinhood":
        if (!evmRecipient) throw new Error("evmRecipient is required");
        return (await this.robinhood.shieldedTransfer(payload, evmRecipient)).hash;
      default:
        throw new Error(`unknown chain ${chain satisfies never}`);
    }
  }

  private requireTree(): MerkleTree {
    if (!this.tree) throw new Error("call init() before using the note tree");
    return this.tree;
  }

  private requireNullifiers(): NullifierSet {
    if (!this.nullifiers) throw new Error("call init() before spending notes");
    return this.nullifiers;
  }

  private requireProver(): ShieldedTransferProver {
    if (!this.prover) throw new Error("call init() before proving");
    return this.prover;
  }
}

function normalizeOutputs(
  outputs: Array<{ value: bigint; recipient: PublicIdentity }>,
  assetId: bigint,
  owner: PrivacyKeys,
): [OutgoingNote, OutgoingNote] {
  if (outputs.length < 1 || outputs.length > 2) {
    throw new Error("a transfer has one or two outputs");
  }
  const first = buildOutgoingNote({
    value: outputs[0]!.value,
    assetId,
    recipient: outputs[0]!.recipient,
    spendingKey: outputs[0]!.recipient.ownerPub === owner.ownerPub ? owner.spendingKey : undefined,
  });
  const secondInput = outputs[1];
  const second = secondInput
    ? buildOutgoingNote({
        value: secondInput.value,
        assetId,
        recipient: secondInput.recipient,
        spendingKey: secondInput.recipient.ownerPub === owner.ownerPub ? owner.spendingKey : undefined,
      })
    : buildOutgoingNote({
        value: 0n,
        assetId,
        recipient: publicIdentity(owner),
        spendingKey: owner.spendingKey,
        memo: "zero change",
      });
  return [first, second];
}
