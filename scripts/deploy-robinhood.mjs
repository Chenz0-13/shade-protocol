import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rpc = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const key = process.env.ROBINHOOD_PRIVATE_KEY;
if (!key) {
  process.stderr.write("Set ROBINHOOD_PRIVATE_KEY. Refusing to deploy without a key.\n");
  process.exit(1);
}
if (rpc.toLowerCase().includes("mainnet")) {
  process.stderr.write("Refusing Robinhood Chain mainnet.\n");
  process.exit(1);
}
const chain = spawnSync(
  "cast",
  ["chain-id", "--rpc-url", rpc],
  { encoding: "utf8" },
);
const chainId = Number(chain.stdout.trim());
if (chainId !== 46630) {
  process.stderr.write(`Refusing chain id ${chainId}. Robinhood Chain testnet is 46630.\n`);
  process.exit(1);
}
const forge = path.join(root, "contracts", "evm");
const run = spawnSync(
  "forge",
  ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--private-key", key, "--broadcast"],
  { cwd: forge, stdio: "inherit", env: { ...process.env, ROBINHOOD_PRIVATE_KEY: key } },
);
process.exit(run.status ?? 1);
