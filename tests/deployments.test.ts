import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { poolPda } from "../src/core/chain/solana.js";
import {
  DEPLOYMENTS,
  FORBIDDEN_CHAIN_IDS,
  assertDeploymentList,
  assertDeploymentSafe,
  deploymentStatus,
  getDeployment,
  type ChainDeployment,
} from "../src/app/deployments.js";

function copy(id: string, patch: Partial<ChainDeployment> = {}): ChainDeployment {
  return { ...getDeployment(id), ...patch };
}

describe("deployments", () => {
  it("publishes the Solana devnet pool and rejects every mainnet id", () => {
    const solana = getDeployment("solana-devnet");
    expect(deploymentStatus(solana)).toBe("deployed");
    expect(solana.programId).toBe("4VnXvKR2pwUio27hG8Q2VHxFj6gFENG6qa4AdqtvobSj");
    expect(solana.poolAddress).toBe("DA56DQtdwGzbSQyy7jLAt76cqnVpW5E6JHg3N7V6DyZF");
    expect(solana.poolAddress).toBe(poolPda(new PublicKey(solana.programId)).toBase58());
    expect(solana.network).toBe("devnet");
    for (const chainId of FORBIDDEN_CHAIN_IDS) {
      expect(chainId).not.toBe(solana.chainId);
    }
  });

  it("keeps undeployed EVM testnets visible and NEAR as coming soon", () => {
    expect(deploymentStatus(getDeployment("robinhood-testnet"))).toBe("not-deployed");
    expect(deploymentStatus(getDeployment("base-sepolia"))).toBe("not-deployed");
    expect(deploymentStatus(getDeployment("hyperevm-testnet"))).toBe("not-deployed");
    expect(deploymentStatus(getDeployment("elysium-testnet"))).toBe("not-deployed");
    expect(deploymentStatus(getDeployment("near-testnet"))).toBe("coming-soon");
    expect(getDeployment("robinhood-testnet").chainId).toBe(46630);
    expect(getDeployment("base-sepolia").chainId).toBe(84532);
    expect(getDeployment("hyperevm-testnet").chainId).toBe(998);
    expect(getDeployment("elysium-testnet").chainId).toBe(99801);
    expect(assertDeploymentList(DEPLOYMENTS)).toBeUndefined();
  });

  it("treats a filled EVM pool as deployed and a zero address as missing", () => {
    const pool = `0x${"11".repeat(20)}`;
    expect(deploymentStatus(copy("base-sepolia", { poolAddress: pool }))).toBe("deployed");
    expect(deploymentStatus(copy("base-sepolia", { poolAddress: `0x${"00".repeat(20)}` }))).toBe("not-deployed");
    expect(deploymentStatus(copy("solana-devnet", { poolAddress: "" }))).toBe("not-deployed");
  });

  it("refuses mainnet chain ids and mainnet RPC urls", () => {
    expect(() => assertDeploymentSafe(copy("base-sepolia", { chainId: 8453 }))).toThrow(/mainnet/i);
    expect(() => assertDeploymentSafe(copy("robinhood-testnet", { chainId: 4663 }))).toThrow(/mainnet/i);
    expect(() => assertDeploymentSafe(copy("hyperevm-testnet", { chainId: 999 }))).toThrow(/mainnet/i);
    expect(() =>
      assertDeploymentSafe(copy("solana-devnet", { rpcUrl: "https://api.mainnet-beta.solana.com" })),
    ).toThrow(/mainnet/i);
    expect(() => assertDeploymentSafe(copy("solana-devnet", { chainId: 101 }))).toThrow(/chain id/i);
    expect(() => assertDeploymentList([copy("base-sepolia"), copy("base-sepolia")])).toThrow(/Duplicate/);
  });
});
