import bs58 from "bs58";
import { ConfigError } from "../errors.js";
import { SOLANA_DEVNET_RPC } from "../constants.js";
import { NEAR_TESTNET_RPC, assertNearChainId, assertNearRpc } from "./near.js";
import { SHADE_LOCAL_PROGRAM_ID } from "./solana.js";
import { ROBINHOOD_TESTNET_CHAIN_ID, ROBINHOOD_TESTNET_RPC, assertRobinhoodTarget } from "./robinhood.js";
import { ELYSIUM_TESTNET_CHAIN_ID, ELYSIUM_TESTNET_RPC, assertElysiumTarget } from "./elysium.js";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC,
  HYPEREVM_TESTNET_CHAIN_ID,
  HYPEREVM_TESTNET_RPC,
  assertBaseSepoliaTarget,
  assertHyperEvmTarget,
} from "./extraEvm.js";

export type SupportedChain = "solana" | "near" | "canton" | "robinhood" | "elysium" | "hyperevm" | "base";

const CHAINS: readonly SupportedChain[] = ["solana", "near", "canton", "robinhood", "elysium", "hyperevm", "base"];

export interface ShadeConfig {
  chains: SupportedChain[];
  solanaRpc: string;
  solanaProgramId: string;
  nearNetwork: string;
  nearRpc: string;
  nearAccountId?: string;
  nearContractId?: string;
  cantonHost: string;
  robinhoodRpc: string;
  robinhoodChainId: number;
  robinhoodPool?: string;
  elysiumRpc: string;
  elysiumChainId: number;
  elysiumPool?: string;
  hyperevmRpc: string;
  hyperevmChainId: number;
  hyperevmPool?: string;
  baseRpc: string;
  baseChainId: number;
  basePool?: string;
}

export interface ResolvedConfig {
  config: ShadeConfig;
  solanaSecretKey?: Uint8Array;
  nearSecretKey?: Uint8Array;
  robinhoodPrivateKey?: `0x${string}`;
  elysiumPrivateKey?: `0x${string}`;
  hyperevmPrivateKey?: `0x${string}`;
  basePrivateKey?: `0x${string}`;
}

export function resolveConfig(
  overrides: Partial<ShadeConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
  solanaSecretKey?: Uint8Array,
): ResolvedConfig {
  const config: ShadeConfig = {
    chains: overrides.chains ?? ["solana"],
    solanaRpc: overrides.solanaRpc ?? env.SOLANA_RPC_URL ?? SOLANA_DEVNET_RPC,
    solanaProgramId: overrides.solanaProgramId ?? env.SHADE_SOLANA_PROGRAM_ID ?? SHADE_LOCAL_PROGRAM_ID,
    nearNetwork: overrides.nearNetwork ?? env.NEAR_NETWORK ?? "testnet",
    nearRpc: overrides.nearRpc ?? env.NEAR_RPC_URL ?? NEAR_TESTNET_RPC,
    nearAccountId: overrides.nearAccountId ?? env.NEAR_ACCOUNT_ID,
    nearContractId: overrides.nearContractId ?? env.NEAR_CONTRACT_ID,
    cantonHost: overrides.cantonHost ?? env.CANTON_HOST ?? "http://127.0.0.1:5000",
    robinhoodRpc: overrides.robinhoodRpc ?? env.ROBINHOOD_RPC_URL ?? ROBINHOOD_TESTNET_RPC,
    robinhoodChainId: overrides.robinhoodChainId ?? numberEnv(env.ROBINHOOD_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID, "ROBINHOOD_CHAIN_ID"),
    robinhoodPool: overrides.robinhoodPool ?? env.ROBINHOOD_POOL,
    elysiumRpc: overrides.elysiumRpc ?? env.ELYSIUM_RPC_URL ?? ELYSIUM_TESTNET_RPC,
    elysiumChainId: overrides.elysiumChainId ?? numberEnv(env.ELYSIUM_CHAIN_ID, ELYSIUM_TESTNET_CHAIN_ID, "ELYSIUM_CHAIN_ID"),
    elysiumPool: overrides.elysiumPool ?? env.ELYSIUM_POOL,
    hyperevmRpc: overrides.hyperevmRpc ?? env.HYPEREVM_RPC_URL ?? HYPEREVM_TESTNET_RPC,
    hyperevmChainId: overrides.hyperevmChainId ?? numberEnv(env.HYPEREVM_CHAIN_ID, HYPEREVM_TESTNET_CHAIN_ID, "HYPEREVM_CHAIN_ID"),
    hyperevmPool: overrides.hyperevmPool ?? env.HYPEREVM_POOL,
    baseRpc: overrides.baseRpc ?? env.BASE_RPC_URL ?? BASE_SEPOLIA_RPC,
    baseChainId: overrides.baseChainId ?? numberEnv(env.BASE_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, "BASE_CHAIN_ID"),
    basePool: overrides.basePool ?? env.BASE_POOL,
  };
  validateConfig(config);
  const secret = solanaSecretKey ?? parseOptionalSolanaSecret(env.SOLANA_KEYPAIR);
  return {
    config,
    solanaSecretKey: secret,
    nearSecretKey: parseOptionalNearSecret(env.NEAR_PRIVATE_KEY),
    robinhoodPrivateKey: parseRobinhoodKey(env.ROBINHOOD_PRIVATE_KEY, "ROBINHOOD_PRIVATE_KEY"),
    elysiumPrivateKey: parseRobinhoodKey(env.ELYSIUM_PRIVATE_KEY, "ELYSIUM_PRIVATE_KEY"),
    hyperevmPrivateKey: parseRobinhoodKey(env.HYPEREVM_PRIVATE_KEY, "HYPEREVM_PRIVATE_KEY"),
    basePrivateKey: parseRobinhoodKey(env.BASE_PRIVATE_KEY, "BASE_PRIVATE_KEY"),
  };
}

export function validateConfig(config: ShadeConfig): void {
  if (config.chains.length === 0) throw new ConfigError("at least one chain is required");
  for (const chain of config.chains) {
    if (!CHAINS.includes(chain)) throw new ConfigError(`unknown chain ${chain}`);
  }
  assertSolanaRpc(config.solanaRpc);
  assertNearRpc(config.nearRpc);
  assertRobinhoodTarget(config.robinhoodRpc, config.robinhoodChainId);
  assertElysiumTarget(config.elysiumRpc, config.elysiumChainId);
  assertHyperEvmTarget(config.hyperevmRpc, config.hyperevmChainId);
  assertBaseSepoliaTarget(config.baseRpc, config.baseChainId);
  try {
    assertNearChainId(config.nearNetwork);
  } catch {
    throw new ConfigError(
      `NEAR network must be testnet, localnet, or sandbox. Refusing "${config.nearNetwork}".`,
    );
  }
  assertLoopback(config.cantonHost);
}

export function assertSolanaRpc(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError("Solana RPC URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError("Solana RPC URL must be http or https");
  }
}

function assertLoopback(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError("Canton host is invalid");
  }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "::1") {
    throw new ConfigError("Canton host must be loopback. Network submission is not implemented.");
  }
}

export function parseOptionalSolanaSecret(value: string | undefined): Uint8Array | undefined {
  if (!value || value.trim() === "") return undefined;
  return parseSolanaSecret(value);
}

export function parseSolanaSecret(value: string): Uint8Array {
  const trimmed = value.trim();
  try {
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((item) => typeof item !== "number")) {
        throw new Error("bad json");
      }
      return Uint8Array.from(parsed);
    }
    if (/^[0-9a-fA-F]{128}$/.test(trimmed)) return Uint8Array.from(Buffer.from(trimmed, "hex"));
  } catch {
    throw new ConfigError("SOLANA_KEYPAIR could not be parsed. Expected a JSON byte array or 128 hex characters.");
  }
  throw new ConfigError("SOLANA_KEYPAIR could not be parsed. Expected a JSON byte array or 128 hex characters.");
}

function numberEnv(value: string | undefined, fallback: number, name: string): number {
  if (!value || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ConfigError(`${name} must be an integer`);
  return parsed;
}

export function parseOptionalNearSecret(value: string | undefined): Uint8Array | undefined {
  if (!value || value.trim() === "") return undefined;
  const trimmed = value.trim().replace(/^ed25519:/, "");
  const bytes = /^[0-9a-fA-F]+$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(bs58.decode(trimmed));
  if (bytes.length === 64) return bytes.subarray(0, 32);
  if (bytes.length === 32) return bytes;
  throw new ConfigError("NEAR_PRIVATE_KEY must be 32 or 64 bytes");
}

function parseRobinhoodKey(value: string | undefined, name: string): `0x${string}` | undefined {
  if (!value || value.trim() === "") return undefined;
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new ConfigError(`${name} must be 32 bytes hex`);
  return hex as `0x${string}`;
}

