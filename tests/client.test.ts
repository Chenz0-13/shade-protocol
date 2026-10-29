import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SOLANA_DEVNET_GENESIS, SOLANA_DEVNET_RPC } from "../src/core/constants.js";
import { SHADE_LOCAL_PROGRAM_ID } from "../src/core/chain/solana.js";
import { publicIdentity } from "../src/core/crypto/keys.js";
import { readNote } from "../src/core/notes/outgoing.js";
import { DoubleSpendError } from "../src/core/errors.js";
import { setLogSink } from "../src/core/log/logger.js";
import { ShieldedTransferProver } from "../src/core/proof/ShieldedTransferProver.js";
import type { SolanaRpc } from "../src/core/chain/solana.js";
import { ShadeClient } from "../src/sdk/ShadeClient.js";

function rpc(sent: Uint8Array[]): SolanaRpc {
  return {
    async getGenesisHash() {
      return SOLANA_DEVNET_GENESIS;
    },
    async getLatestBlockhash() {
      return { blockhash: bs58.encode(Buffer.alloc(32, 3)) };
    },
    async sendRawTransaction(raw) {
      sent.push(raw);
      const tx = Transaction.from(Buffer.from(raw));
      return bs58.encode(tx.signatures[0]!.signature!);
    },
  };
}

describe("ShadeClient", () => {
  let prover: ShieldedTransferProver;

  beforeAll(() => {
    prover = ShieldedTransferProver.load();
  });

  afterEach(() => setLogSink(null));

  it("transfers on devnet with a real proof and refuses a second spend", async () => {
    const sent: Uint8Array[] = [];
    const secret = Keypair.generate().secretKey;
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    const client = new ShadeClient({
      config: { chains: ["solana", "near"] },
      solanaSecretKey: secret,
      solanaRpc: rpc(sent),
      prover,
      env: {},
    });
    await client.init();
    expect(lines.join("\n")).not.toContain(Buffer.from(secret).toString("hex"));
    expect(client.config.solanaRpc).toBe(SOLANA_DEVNET_RPC);

    const owner = client.generateKeys();
    const recipient = client.generateKeys();
    const minted = client.mintNote(owner, 80n);
    const result = await client.shieldedTransfer({
      chain: "solana",
      owner,
      inputIndex: minted.opening.index,
      valueIn: minted.opening.value,
      blindingIn: minted.opening.blinding,
      rhoIn: minted.opening.rho,
      assetId: minted.opening.assetId,
      outputs: [{ value: 80n, recipient: publicIdentity(recipient) }],
    });
    expect(sent).toHaveLength(1);
    expect(result.signature.length).toBeGreaterThan(20);
    const instruction = Transaction.from(Buffer.from(sent[0]!)).instructions[0]!;
    expect(instruction.programId.equals(new PublicKey(SHADE_LOCAL_PROGRAM_ID))).toBe(true);
    expect(instruction.data[0]).toBe(1);
    const received = result.outputs.find((output) => output.ownerPub === recipient.ownerPub);
    expect(received).toBeDefined();
    expect(readNote(recipient, received!).value).toBe(80n);

    await expect(
      client.shieldedTransfer({
        chain: "solana",
        owner,
        inputIndex: minted.opening.index,
        valueIn: minted.opening.value,
        blindingIn: minted.opening.blinding,
        rhoIn: minted.opening.rho,
        assetId: minted.opening.assetId,
        outputs: [{ value: 80n, recipient: publicIdentity(recipient) }],
      }),
    ).rejects.toBeInstanceOf(DoubleSpendError);
    expect(sent).toHaveLength(1);
  });
});
