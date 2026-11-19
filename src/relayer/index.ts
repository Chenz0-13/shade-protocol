import { readFile } from "node:fs/promises";
import { groth16 } from "snarkjs";
import { loadConfig } from "./config.js";
import { createRelayer } from "./server.js";
import type { RelayRequest } from "./types.js";

const config = loadConfig(process.env);
const vkey = JSON.parse(await readFile(config.vkeyPath, "utf8")) as object;
const server = createRelayer({
  chains: config.chains,
  privateKey: config.privateKey,
  maxGasPrice: config.maxGasPrice,
  assumedGas: config.assumedGas,
  verify: (proof: RelayRequest["proof"], publicSignals: string[]) =>
    groth16.verify(vkey, publicSignals, {
      protocol: "groth16",
      curve: "bn128",
      pi_a: proof.pi_a,
      pi_b: proof.pi_b,
      pi_c: proof.pi_c,
    }),
});
server.listen(config.port, "0.0.0.0");
