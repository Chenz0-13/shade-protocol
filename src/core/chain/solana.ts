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
  SOLANA_TESTNET_GENESIS,
} from "../constants.js";
import { ConfigError } from "../errors.js";
import type { Groth16Proof } from "snarkjs";
import { assertSolanaRpc } from "./config.js";

/** BN254 base field. Proof coordinates live here, not in the scalar field. */
const FQ = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

export const SHADE_LOCAL_PROGRAM_ID = "2ThVE9c8Gf9WVrof4NejHGnFjK16izVjBM4sUJvofvwK";

export interface ChainSubmission {
  merkleRoot: string;
  nullifier: string;
  commitmentOut1: string;
  commitmentOut2: string;
  fee: string;
  proof: Groth16Proof;
}

export interface SolanaRpc {
  getGenesisHash(): Promise<string>;
  getLatestBlockhash(): Promise<{ blockhash: string }>;
  sendRawTransaction(raw: Uint8Array): Promise<string>;
}

const ALLOWED_GENESIS = new Set([SOLANA_DEVNET_GENESIS, SOLANA_TESTNET_GENESIS]);

/**
 * Submits a signed transaction to the Shade program. The instruction carries
 * the Groth16 proof in the byte layout `groth16-solana` verifies, plus the
 * five public inputs. Mainnet genesis hashes are rejected. Without a keypair
 * or program id the adapter throws instead of inventing a signature.
 */
export class SolanaDevnetAdapter {
  private readonly signer?: Keypair;
  readonly programId: PublicKey;

  constructor(
    private readonly options: {
      rpcUrl: string;
      secretKey?: Uint8Array;
      programId?: string;
      rpc?: SolanaRpc;
      allowLocalGenesis?: boolean;
    },
  ) {
    assertSolanaRpc(options.rpcUrl);
    if (!options.programId) {
      throw new ConfigError(
        "SHADE_SOLANA_PROGRAM_ID is required. Deploy the Shade program to devnet and pass its id. Refusing to anchor the proof in a memo.",
      );
    }
    this.programId = new PublicKey(options.programId);
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
    const data = encodeShadeTransfer(payload);
    const transaction = new Transaction();
    transaction.feePayer = this.signer.publicKey;
    transaction.recentBlockhash = blockhash;
    transaction.add(
      new TransactionInstruction({
        programId: this.programId,
        keys: [
          { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
          { pubkey: this.signer.publicKey, isSigner: false, isWritable: true },
          { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
        ],
        data,
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

/** Instruction tag 1, then negated-A || B || C || five scalar public inputs. */
export function encodeShadeTransfer(payload: ChainSubmission): Buffer {
  const proofA = g1(payload.proof.pi_a, true);
  const proofB = g2(payload.proof.pi_b);
  const proofC = g1(payload.proof.pi_c, false);
  const inputs = [payload.merkleRoot, payload.nullifier, payload.commitmentOut1, payload.commitmentOut2, payload.fee].map(
    (value) => be32(BigInt(value), scalarPrime()),
  );
  return Buffer.concat([Buffer.from([1]), proofA, proofB, proofC, ...inputs]);
}

function scalarPrime(): bigint {
  return 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
}

function be32(value: bigint, prime: bigint): Buffer {
  if (value < 0n || value >= prime) throw new Error("field element is out of range");
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

function g1(point: string[], negate: boolean): Buffer {
  const x = BigInt(point[0] ?? "0");
  let y = BigInt(point[1] ?? "0");
  if (negate && y !== 0n) y = FQ - y;
  return Buffer.concat([be32(x, FQ), be32(y, FQ)]);
}

function g2(point: string[][]): Buffer {
  const x0 = BigInt(point[0]?.[0] ?? "0");
  const x1 = BigInt(point[0]?.[1] ?? "0");
  const y0 = BigInt(point[1]?.[0] ?? "0");
  const y1 = BigInt(point[1]?.[1] ?? "0");
  return Buffer.concat([be32(x1, FQ), be32(x0, FQ), be32(y1, FQ), be32(y0, FQ)]);
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
