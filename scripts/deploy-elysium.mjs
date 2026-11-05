import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SHADE_BROADCAST !== "1") {
  process.stderr.write("Refusing to broadcast. Set SHADE_BROADCAST=1 after reading docs/deploy.md. No transaction was sent.\n");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rpc = process.env.ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz";
const key = process.env.ELYSIUM_PRIVATE_KEY;
if (!key) {
  process.stderr.write("Set ELYSIUM_PRIVATE_KEY. Refusing to deploy without a key.\n");
  process.exit(1);
}
const chain = spawnSync("cast", ["chain-id", "--rpc-url", rpc], { encoding: "utf8" });
const chainId = Number(chain.stdout.trim());
if (chainId !== 99801) {
  process.stderr.write(`Refusing chain id ${chainId}. Kinetiq Elysium testnet is 99801.\n`);
  process.exit(1);
}
const forge = path.join(root, "contracts", "evm");
const run = spawnSync(
  "forge",
  ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast"],
  { cwd: forge, stdio: "inherit", env: { ...process.env, DEPLOYER_PRIVATE_KEY: key } },
);
process.exit(run.status ?? 1);
