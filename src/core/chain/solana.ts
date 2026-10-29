import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  SOLANA_DEVNET_GENESIS,
  SOLANA_MAINNET_GENESIS,
  SOLANA_MEMO_PROGRAM,
  SOLANA_TESTNET_GENESIS,
} from "../constants.js";
import { ConfigError } from "../errors.js";
import { assertSolanaRpc } from "./config.js";

export interface ChainSubmission {
  merkleRoot: string;
  nullifier: string;
  commitmentOut1: string;
  commitmentOut2: string;
  fee: string;
}

export interface SolanaRpc {
  getGenesisHash(): Promise<string>;
  getLatestBlockhash(): Promise<{ blockhash: string }>;
  sendRawTransaction(raw: Uint8Array): Promise<string>;
}

const ALLOWED_GENESIS = new Set([SOLANA_DEVNET_GENESIS, SOLANA_TESTNET_GENESIS]);

/**
 * Submits a real signed Solana transaction whose memo is the public proof
 * inputs. There is no deployed Shade program yet, so the memo is the devnet
 * anchor for those public inputs. Mainnet genesis hashes are rejected.
 * Without a keypair the adapter throws instead of inventing a signature.
 */
export class SolanaDevnetAdapter {
  private readonly signer?: Keypair;

  constructor(
    private readonly options: {
      rpcUrl: string;
      secretKey?: Uint8Array;
      rpc?: SolanaRpc;
      allowLocalGenesis?: boolean;
    },
  ) {
    assertSolanaRpc(options.rpcUrl);
    if (options.secretKey) this.signer = Keypair.fromSecretKey(options.secretKey);
  }

  async submit(payload: ChainSubmission): Promise<{ signature: string }> {
    if (!this.signer) {
      throw new ConfigError(
        "SOLANA_KEYPAIR is required to submit to Solana devnet. Refusing to invent a transaction signature.",
      );
    }
    const rpc = this.options.rpc ?? (await defaultRpc(this.options.rpcUrl));
    const genesis = await rpc.getGenesisHash();
    this.assertGenesis(genesis);
    const { blockhash } = await rpc.getLatestBlockhash();
    const memo = JSON.stringify({
      v: 1,
      root: payload.merkleRoot,
      nullifier: payload.nullifier,
      out1: payload.commitmentOut1,
      out2: payload.commitmentOut2,
      fee: payload.fee,
    });
    const transaction = new Transaction();
    transaction.feePayer = this.signer.publicKey;
    transaction.recentBlockhash = blockhash;
    transaction.add(
      new TransactionInstruction({
        programId: new PublicKey(SOLANA_MEMO_PROGRAM),
        keys: [{ pubkey: this.signer.publicKey, isSigner: true, isWritable: false }],
        data: Buffer.from(memo, "utf8"),
      }),
    );
    transaction.sign(this.signer);
    const raw = transaction.serialize();
    const expected = bs58.encode(transaction.signatures[0]!.signature!);
    const returned = await rpc.sendRawTransaction(raw);
    if (returned !== expected) {
      throw new Error("Solana RPC returned a signature that does not match the signed transaction");
    }
    return { signature: expected };
  }

  private assertGenesis(genesis: string): void {
    if (genesis === SOLANA_MAINNET_GENESIS) {
      throw new ConfigError("Refusing Solana mainnet genesis hash.");
    }
    const local = this.options.allowLocalGenesis === true || isLocal(this.options.rpcUrl);
    if (local && genesis !== SOLANA_MAINNET_GENESIS) return;
    if (!ALLOWED_GENESIS.has(genesis)) {
      throw new ConfigError("Solana genesis hash is not devnet or testnet.");
    }
  }
}

function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function defaultRpc(rpcUrl: string): Promise<SolanaRpc> {
  const { Connection } = await import("@solana/web3.js");
  const connection = new Connection(rpcUrl, "confirmed");
  return {
    getGenesisHash: () => connection.getGenesisHash(),
    getLatestBlockhash: async () => {
      const latest = await connection.getLatestBlockhash("confirmed");
      return { blockhash: latest.blockhash };
    },
    sendRawTransaction: (raw) => connection.sendRawTransaction(raw, { skipPreflight: false }),
  };
}
