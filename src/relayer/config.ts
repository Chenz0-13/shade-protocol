import { DEPLOYMENTS, FORBIDDEN_CHAIN_IDS, isEvmAddress } from "../app/deployments.js";
import type { RelayerChain } from "./types.js";

const ENABLED = new Set([46630, 99801]);
const PLACEHOLDERS = new Set([998, 84532]);

export interface RelayerConfig {
  privateKey: `0x${string}`;
  port: number;
  fee: bigint;
  maxGasPrice: bigint;
  assumedGas: bigint;
  vkeyPath: string;
  chains: RelayerChain[];
}

export function loadConfig(env: NodeJS.ProcessEnv): RelayerConfig {
  const fee = readUint(env.RELAYER_FEE_WEI, 1_000_000_000_000_000n);
  const maxGasPrice = readUint(env.RELAYER_MAX_GAS_WEI, 20_000_000_000n);
  const assumedGas = readUint(env.RELAYER_ASSUMED_GAS, 2_000_000n);
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is not a valid port.");
  if (fee <= 0n) throw new Error("RELAYER_FEE_WEI must be greater than zero.");
  return {
    privateKey: readKey(env.RELAYER_PRIVATE_KEY),
    port,
    fee,
    maxGasPrice,
    assumedGas,
    vkeyPath: env.RELAYER_VKEY ?? "circuits/pinned/verification_key.json",
    chains: chainsFromDeployments(env, fee),
  };
}

export function chainsFromDeployments(env: NodeJS.ProcessEnv, fee: bigint): RelayerChain[] {
  const wanted = [...ENABLED, ...PLACEHOLDERS];
  return wanted.map((chainId) => {
    const deployment = DEPLOYMENTS.find((item) => item.chainId === chainId);
    if (!deployment || deployment.kind !== "evm") throw new Error(`Missing testnet config for chain ${chainId}.`);
    if (FORBIDDEN_CHAIN_IDS.includes(chainId)) throw new Error(`Refusing mainnet chain ${chainId}.`);
    const override = env[`RELAYER_FEE_WEI_${chainId}`];
    const chainFee = override === undefined ? fee : readUint(override, fee);
    const pool = isEvmAddress(deployment.poolAddress) ? deployment.poolAddress : "";
    return {
      chainId,
      name: deployment.name,
      rpcUrl: deployment.rpcUrl,
      pool,
      enabled: ENABLED.has(chainId) && pool !== "" && !/^0x0{40}$/i.test(pool),
      fee: chainFee,
      symbol: deployment.nativeSymbol,
      decimals: deployment.nativeDecimals,
    };
  });
}

function readKey(value: string | undefined): `0x${string}` {
  const trimmed = value?.trim() ?? "";
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("RELAYER_PRIVATE_KEY must be a 32-byte hex key.");
  return hex as `0x${string}`;
}

function readUint(value: string | undefined, fallback: bigint): bigint {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[0-9]+$/.test(value.trim())) throw new Error("A relayer amount must be a whole number of wei.");
  return BigInt(value.trim());
}
