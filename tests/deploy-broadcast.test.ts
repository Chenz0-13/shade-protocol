import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const scripts = [
  ["node", "scripts/deploy-robinhood.mjs"],
  ["node", "scripts/deploy-elysium.mjs"],
  ["node", "scripts/deploy-hyperevm.mjs"],
  ["node", "scripts/deploy-base.mjs"],
  ["sh", "scripts/deploy-solana.sh"],
  ["sh", "scripts/deploy-near.sh"],
  ["sh", "scripts/deploy-all-testnets.sh"],
  ["node", "scripts/smoke-deployment.mjs", "--chain", "evm"],
  ["node", "scripts/smoke-deployment.mjs", "--chain", "near"],
];

describe("testnet scripts refuse to broadcast", () => {
  for (const command of scripts) {
    it(`${command.join(" ")} stays quiet without SHADE_BROADCAST=1`, () => {
      const run = spawnSync(command[0], command.slice(1), {
        encoding: "utf8",
        env: { ...process.env, SHADE_BROADCAST: "0" },
      });
      expect(run.status).toBe(0);
      expect(run.stderr).toContain("Refusing to broadcast");
      expect(run.stderr).not.toMatch(/0x[0-9a-fA-F]{64}/);
    });
  }
});
