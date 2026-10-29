import bs58 from "bs58";
import { ConfigError } from "../errors.js";
import { SOLANA_DEVNET_RPC } from "../constants.js";
import { NEAR_TESTNET_RPC, assertNearRpc } from "./near.js";
import { SHADE_LOCAL_PROGRAM_ID } from "./solana.js";
import { ROBINHOOD_TESTNET_CHAIN_ID, ROBINHOOD_TESTNET_RPC, assertRobinhoodTarget } from "./robinhood.js";

export type SupportedChain = "solana" | "near" | "canton" | "robinhood";

const CHAINS: readonly SupportedChain[] = ["solana", "near", "canton", "robinhood"];

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
}

export interface ResolvedConfig {
  config: ShadeConfig;
  solanaSecretKey?: Uint8Array;
  nearSecretKey?: Uint8Array;
  robinhoodPrivateKey?: `0x${string}`;
}

const MAINNET = /(^|[./:_-])mainnet(-beta)?([./:_-]|$)/i;

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
    robinhoodChainId: overrides.robinhoodChainId ?? numberEnv(env.ROBINHOOD_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID),
    robinhoodPool: overrides.robinhoodPool ?? env.ROBINHOOD_POOL,
  };
  validateConfig(config);
  const secret = solanaSecretKey ?? parseOptionalSolanaSecret(env.SOLANA_KEYPAIR);
  return {
    config,
    solanaSecretKey: secret,
    nearSecretKey: parseOptionalNearSecret(env.NEAR_PRIVATE_KEY),
    robinhoodPrivateKey: parseRobinhoodKey(env.ROBINHOOD_PRIVATE_KEY),
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
  if (!["testnet", "localnet", "sandbox"].includes(config.nearNetwork)) {
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
  if (MAINNET.test(url) || MAINNET.test(parsed.hostname) || MAINNET.test(parsed.pathname)) {
    throw new ConfigError(
      `Refusing Solana mainnet RPC ${parsed.origin}. Configure a devnet, testnet, or localhost endpoint.`,
    );
  }
  const host = parsed.hostname;
  const allowed =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    url.toLowerCase().includes("devnet") ||
    url.toLowerCase().includes("testnet");
  if (!allowed) {
    throw new ConfigError(
      "Solana RPC must be an explicit devnet, testnet, or localhost endpoint.",
    );
  }
}

function assertLoopback(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError("Canton host is invalid");
  }
  if (MAINNET.test(value)) throw new ConfigError("Refusing a mainnet Canton host");
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

function numberEnv(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ConfigError("ROBINHOOD_CHAIN_ID must be an integer");
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

function parseRobinhoodKey(value: string | undefined): `0x${string}` | undefined {
  if (!value || value.trim() === "") return undefined;
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new ConfigError("ROBINHOOD_PRIVATE_KEY must be 32 bytes hex");
  return hex as `0x${string}`;
}

