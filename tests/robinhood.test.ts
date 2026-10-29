import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/core/errors.js";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_TESTNET_CHAIN_ID,
  RobinhoodTestnetAdapter,
  assertRobinhoodTarget,
  solidityProof,
} from "../src/core/chain/robinhood.js";
import type { ChainSubmission } from "../src/core/chain/solana.js";

describe("Robinhood Chain adapter", () => {
  it("rejects mainnet and swaps snarkjs Fq2 limbs for the Solidity verifier", async () => {
    expect(() =>
      assertRobinhoodTarget("https://rpc.mainnet.chain.robinhood.com", ROBINHOOD_MAINNET_CHAIN_ID),
    ).toThrow(ConfigError);
    expect(() => assertRobinhoodTarget("https://rpc.testnet.chain.robinhood.com", ROBINHOOD_TESTNET_CHAIN_ID)).not.toThrow();
    const payload: ChainSubmission = {
      merkleRoot: "1",
      nullifier: "2",
      commitmentOut1: "3",
      commitmentOut2: "4",
      fee: "5",
      proof: {
        pi_a: ["9", "8", "1"],
        pi_b: [
          ["11", "10"],
          ["13", "12"],
          ["1", "0"],
        ],
        pi_c: ["7", "6", "1"],
        protocol: "groth16",
        curve: "bn128",
      },
    };
    const encoded = solidityProof(payload);
    expect(encoded.pB[0]).toEqual([10n, 11n]);
    expect(encoded.pubSignals[4]).toBe(5n);
    await expect(
      new RobinhoodTestnetAdapter({
        rpcUrl: "https://rpc.testnet.chain.robinhood.com",
        chainId: ROBINHOOD_TESTNET_CHAIN_ID,
      }).shieldedTransfer(payload, "0x0000000000000000000000000000000000000001"),
    ).rejects.toThrow(/ROBINHOOD_POOL/);
  });
});
