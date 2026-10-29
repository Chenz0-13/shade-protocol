import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { SOLANA_DEVNET_GENESIS, SOLANA_DEVNET_RPC, SOLANA_MAINNET_GENESIS } from "../src/core/constants.js";
import { ConfigError, NotImplementedError } from "../src/core/errors.js";
import { submitCanton } from "../src/core/chain/canton.js";
import { resolveConfig } from "../src/core/chain/config.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { NearTestnetAdapter, signFunctionCall } from "../src/core/chain/near.js";
import {
  SHADE_LOCAL_PROGRAM_ID,
  SolanaDevnetAdapter,
  encodeShadeTransfer,
  type ChainSubmission,
  type SolanaRpc,
} from "../src/core/chain/solana.js";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../src/core/chain/robinhood.js";
import type { Groth16Proof } from "snarkjs";

const proof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
  protocol: "groth16",
  curve: "bn128",
} as Groth16Proof;

const payload: ChainSubmission = {
  merkleRoot: "11",
  nullifier: "22",
  commitmentOut1: "33",
  commitmentOut2: "44",
  fee: "0",
  proof,
};

function rpc(genesis: string, sent: Uint8Array[]): SolanaRpc {
  return {
    async getGenesisHash() {
      return genesis;
    },
    async getLatestBlockhash() {
      return { blockhash: bs58.encode(Buffer.alloc(32, 2)) };
    },
    async sendRawTransaction(raw) {
      sent.push(raw);
      const tx = Transaction.from(Buffer.from(raw));
      const signature = tx.signatures[0]?.signature;
      if (!signature) throw new Error("unsigned transaction");
      return bs58.encode(signature);
    },
  };
}

describe("chain configuration", () => {
  it("defaults to devnet and rejects mainnet", () => {
    const resolved = resolveConfig({}, {});
    expect(resolved.config.solanaRpc).toBe(SOLANA_DEVNET_RPC);
    expect(resolved.config.nearNetwork).toBe("testnet");
    expect(() =>
      resolveConfig({}, { SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" }),
    ).toThrow(ConfigError);
    expect(() => resolveConfig({}, { NEAR_NETWORK: "mainnet" })).toThrow(/testnet/);
    expect(() => resolveConfig({ cantonHost: "https://canton.example.com" })).toThrow(/loopback/);
    expect(() =>
      resolveConfig({ robinhoodRpc: "https://rpc.mainnet.chain.robinhood.com", robinhoodChainId: ROBINHOOD_MAINNET_CHAIN_ID }),
    ).toThrow(/mainnet/);
    expect(resolveConfig({}, {}).config.solanaProgramId).toBe(SHADE_LOCAL_PROGRAM_ID);
  });
});

describe("submission adapters", () => {
  it("signs a Shade program transaction and refuses mainnet or a missing key", async () => {
    const sent: Uint8Array[] = [];
    const signer = Keypair.generate();
    const adapter = new SolanaDevnetAdapter({
      rpcUrl: SOLANA_DEVNET_RPC,
      programId: SHADE_LOCAL_PROGRAM_ID,
      secretKey: signer.secretKey,
      rpc: rpc(SOLANA_DEVNET_GENESIS, sent),
    });
    const { signature } = await adapter.submit(payload);
    expect(sent).toHaveLength(1);
    const tx = Transaction.from(Buffer.from(sent[0]!));
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.instructions[0]?.programId.toBase58()).toBe(SHADE_LOCAL_PROGRAM_ID);
    const data = tx.instructions[0]!.data;
    expect(data[0]).toBe(1);
    expect(data.subarray(1 + 64 + 128 + 64, 1 + 64 + 128 + 64 + 32)).toEqual(encodeShadeTransfer(payload).subarray(1 + 64 + 128 + 64, 1 + 64 + 128 + 96));
    expect(data.toString("utf8")).not.toContain("spending");
    expect(signature).toBe(bs58.encode(tx.signatures[0]!.signature!));

    await expect(
      new SolanaDevnetAdapter({
        rpcUrl: SOLANA_DEVNET_RPC,
        programId: SHADE_LOCAL_PROGRAM_ID,
        secretKey: signer.secretKey,
        rpc: rpc(SOLANA_MAINNET_GENESIS, []),
      }).submit(payload),
    ).rejects.toThrow(/mainnet/);

    await expect(
      new SolanaDevnetAdapter({ rpcUrl: SOLANA_DEVNET_RPC, programId: SHADE_LOCAL_PROGRAM_ID }).submit(payload),
    ).rejects.toThrow(/invent a transaction signature/);
    expect(() => new SolanaDevnetAdapter({ rpcUrl: "https://api.mainnet-beta.solana.com" })).toThrow(ConfigError);
  });

  it("signs a NEAR function call and refuses Canton and an unconfigured account", async () => {
    const secret = ed25519.utils.randomSecretKey();
    const signed = signFunctionCall({
      signerId: "alice.testnet",
      secretKey: secret,
      receiverId: "shade.testnet",
      methodName: "shielded_transfer",
      args: Buffer.from("{\"fee\":\"0\"}"),
      gas: 1n,
      deposit: 0n,
      nonce: 1n,
      blockHash: new Uint8Array(32).fill(7),
    });
    const tx = signed.subarray(0, signed.length - 65);
    const signature = signed.subarray(signed.length - 64);
    expect(ed25519.verify(signature, sha256(tx), ed25519.getPublicKey(secret))).toBe(true);
    expect(Buffer.from(signed).toString("utf8")).toContain("shielded_transfer");
    const sent: Uint8Array[] = [];
    const adapter = new NearTestnetAdapter({
      rpcUrl: "https://rpc.testnet.near.org",
      accountId: "alice.testnet",
      contractId: "shade.testnet",
      secretKey: secret,
      send: async (bytes) => {
        sent.push(bytes);
        return "signed-locally";
      },
    });
    expect((await adapter.shieldedTransfer(payload, "bob.testnet")).hash).toBe("signed-locally");
    expect(sent[0]?.byteLength).toBeGreaterThan(64);
    await expect(new NearTestnetAdapter({ rpcUrl: "https://rpc.testnet.near.org" }).shieldedTransfer(payload, "bob.testnet")).rejects.toThrow(
      /NEAR_ACCOUNT_ID/,
    );
    expect(() => new NearTestnetAdapter({ rpcUrl: "https://rpc.mainnet.near.org" })).toThrow(/mainnet/);
    expect(() => submitCanton()).toThrow(NotImplementedError);
    expect(() => submitCanton()).toThrow(/BN254/);
  });
});
