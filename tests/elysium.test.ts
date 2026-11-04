import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/core/errors.js";
import {
  ELYSIUM_TESTNET_CHAIN_ID,
  ELYSIUM_TESTNET_RPC,
  ElysiumTestnetAdapter,
  assertElysiumTarget,
  elysiumTestnet,
} from "../src/core/chain/elysium.js";

describe("Kinetiq Elysium testnet", () => {
  it("is chain 99801 and rejects every other id, including viem's elysiumTestnet 1338", () => {
    expect(elysiumTestnet.id).toBe(ELYSIUM_TESTNET_CHAIN_ID);
    expect(elysiumTestnet.nativeCurrency.symbol).toBe("HYPE");
    expect(elysiumTestnet.nativeCurrency.decimals).toBe(18);
    expect(() => assertElysiumTarget(ELYSIUM_TESTNET_RPC, ELYSIUM_TESTNET_CHAIN_ID)).not.toThrow();
    expect(() => assertElysiumTarget(ELYSIUM_TESTNET_RPC, 1338)).toThrow(/99801/);
    expect(() => assertElysiumTarget("https://elysium.example/mainnet", ELYSIUM_TESTNET_CHAIN_ID)).not.toThrow();
    expect(() => assertElysiumTarget(ELYSIUM_TESTNET_RPC, 1)).toThrow(ConfigError);
    expect(() => new ElysiumTestnetAdapter({ rpcUrl: ELYSIUM_TESTNET_RPC, chainId: 1 })).toThrow(/99801/);
  });
});