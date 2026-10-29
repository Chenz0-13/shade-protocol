import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { SOLANA_DEVNET_GENESIS, SOLANA_DEVNET_RPC, SOLANA_MAINNET_GENESIS, SOLANA_MEMO_PROGRAM } from "../src/core/constants.js";
import { ConfigError, NotImplementedError } from "../src/core/errors.js";
import { resolveConfig } from "../src/core/chain/config.js";
import { SolanaDevnetAdapter, type ChainSubmission, type SolanaRpc } from "../src/core/chain/solana.js";
import { submitCanton, submitNear, submitRobinhood } from "../src/core/chain/unsupported.js";

const payload: ChainSubmission = {
  merkleRoot: "11",
  nullifier: "22",
  commitmentOut1: "33",
  commitmentOut2: "44",
  fee: "0",
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
  });
});

describe("submission adapters", () => {
  it("signs a real devnet memo transaction and refuses mainnet or a missing key", async () => {
    const sent: Uint8Array[] = [];
    const signer = Keypair.generate();
    const adapter = new SolanaDevnetAdapter({
      rpcUrl: SOLANA_DEVNET_RPC,
      secretKey: signer.secretKey,
      rpc: rpc(SOLANA_DEVNET_GENESIS, sent),
    });
    const { signature } = await adapter.submit(payload);
    expect(sent).toHaveLength(1);
    const tx = Transaction.from(Buffer.from(sent[0]!));
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.instructions[0]?.programId.toBase58()).toBe(SOLANA_MEMO_PROGRAM);
    const memo = JSON.parse(tx.instructions[0]!.data.toString("utf8")) as { nullifier: string };
    expect(memo.nullifier).toBe(payload.nullifier);
    expect(tx.instructions[0]!.data.toString("utf8")).not.toContain("spending");
    expect(signature).toBe(bs58.encode(tx.signatures[0]!.signature!));

    await expect(
      new SolanaDevnetAdapter({
        rpcUrl: SOLANA_DEVNET_RPC,
        secretKey: signer.secretKey,
        rpc: rpc(SOLANA_MAINNET_GENESIS, []),
      }).submit(payload),
    ).rejects.toThrow(/mainnet/);

    await expect(new SolanaDevnetAdapter({ rpcUrl: SOLANA_DEVNET_RPC }).submit(payload)).rejects.toThrow(
      /invent a transaction signature/,
    );
    expect(() => new SolanaDevnetAdapter({ rpcUrl: "https://api.mainnet-beta.solana.com" })).toThrow(ConfigError);
  });

  it("throws instead of faking NEAR, Canton, and Robinhood submission", async () => {
    await expect(submitNear(payload)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(submitCanton(payload)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(submitRobinhood(payload)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
