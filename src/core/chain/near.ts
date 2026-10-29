import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import { ConfigError } from "../errors.js";
import type { ChainSubmission } from "./solana.js";

export const NEAR_TESTNET_RPC = "https://rpc.testnet.near.org";

export function assertNearRpc(url: string): void {
  const lower = url.toLowerCase();
  if (lower.includes("mainnet") || (lower.includes("rpc.near.org") && !lower.includes("testnet"))) {
    throw new ConfigError("Refusing NEAR mainnet RPC. Use https://rpc.testnet.near.org or a local sandbox.");
  }
}

/**
 * Signs a NEAR function-call transaction with ed25519. The production send
 * path broadcasts the signed bytes. Tests inject `send` so they can inspect
 * the transaction without a funded account.
 */
export class NearTestnetAdapter {
  constructor(
    private readonly options: {
      rpcUrl: string;
      accountId?: string;
      contractId?: string;
      secretKey?: Uint8Array;
      send?: (signed: Uint8Array) => Promise<string>;
    },
  ) {
    assertNearRpc(options.rpcUrl);
  }

  async shieldedTransfer(payload: ChainSubmission, recipient: string): Promise<{ hash: string }> {
    const { accountId, contractId, secretKey } = this.options;
    if (!accountId || !contractId || !secretKey) {
      throw new ConfigError(
        "NEAR_ACCOUNT_ID, NEAR_CONTRACT_ID, and NEAR_PRIVATE_KEY are required. Refusing to invent a transaction hash.",
      );
    }
    const args = Buffer.from(
      JSON.stringify({
        proof_json: JSON.stringify(payload.proof),
        public_inputs: [
          payload.merkleRoot,
          payload.nullifier,
          payload.commitmentOut1,
          payload.commitmentOut2,
          payload.fee,
        ],
        recipient,
      }),
    );
    const signed = signFunctionCall({
      signerId: accountId,
      secretKey,
      receiverId: contractId,
      methodName: "shielded_transfer",
      args,
      gas: 300_000_000_000_000n,
      deposit: 0n,
      nonce: 1n,
      blockHash: new Uint8Array(32).fill(1),
    });
    if (this.options.send) return { hash: await this.options.send(signed) };
    const body = {
      jsonrpc: "2.0",
      id: "shade",
      method: "broadcast_tx_commit",
      params: [bs58.encode(signed)],
    };
    const response = await fetch(this.options.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json()) as { result?: { transaction?: { hash?: string } }; error?: { message?: string } };
    if (!parsed.result?.transaction?.hash) {
      throw new Error(parsed.error?.message ?? "NEAR RPC did not return a transaction hash");
    }
    return { hash: parsed.result.transaction.hash };
  }
}

export function signFunctionCall(params: {
  signerId: string;
  secretKey: Uint8Array;
  receiverId: string;
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
  nonce: bigint;
  blockHash: Uint8Array;
}): Uint8Array {
  if (params.secretKey.length !== 32) throw new ConfigError("NEAR secret key must be 32 bytes");
  const publicKey = ed25519.getPublicKey(params.secretKey);
  const tx = Buffer.concat([
    borshString(params.signerId),
    Buffer.from([0]),
    publicKey,
    u64(params.nonce),
    borshString(params.receiverId),
    Buffer.from(params.blockHash),
    u32(1),
    Buffer.from([2]),
    borshString(params.methodName),
    u32(params.args.length),
    Buffer.from(params.args),
    u64(params.gas),
    u128(params.deposit),
  ]);
  const signature = ed25519.sign(sha256(tx), params.secretKey);
  return Buffer.concat([tx, Buffer.from([0]), signature]);
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function u128(value: bigint): Buffer {
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(value & ((1n << 64n) - 1n), 0);
  out.writeBigUInt64LE(value >> 64n, 8);
  return out;
}
