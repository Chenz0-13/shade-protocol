import { ConfigError } from "../errors.js";
import { SOLANA_DEVNET_RPC } from "../constants.js";

export type SupportedChain = "solana" | "near" | "canton" | "robinhood";

const CHAINS: readonly SupportedChain[] = ["solana", "near", "canton", "robinhood"];

export interface ShadeConfig {
  chains: SupportedChain[];
  solanaRpc: string;
  nearNetwork: string;
  cantonHost: string;
}

export interface ResolvedConfig {
  config: ShadeConfig;
  solanaSecretKey?: Uint8Array;
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
    nearNetwork: overrides.nearNetwork ?? env.NEAR_NETWORK ?? "testnet",
    cantonHost: overrides.cantonHost ?? env.CANTON_HOST ?? "http://127.0.0.1:5000",
  };
  validateConfig(config);
  const secret = solanaSecretKey ?? parseOptionalSolanaSecret(env.SOLANA_KEYPAIR);
  return { config, solanaSecretKey: secret };
}

export function validateConfig(config: ShadeConfig): void {
  if (config.chains.length === 0) throw new ConfigError("at least one chain is required");
  for (const chain of config.chains) {
    if (!CHAINS.includes(chain)) throw new ConfigError(`unknown chain ${chain}`);
  }
  assertSolanaRpc(config.solanaRpc);
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
