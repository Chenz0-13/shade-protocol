import { EXT_DOMAIN } from "../core/constants.js";

/**
 * Testnet deployments for the Shader app.
 * A missing pool address means that chain is shown as not deployed yet.
 * Mainnet chain ids and RPC URLs are rejected.
 */

export type DeploymentKind = "solana" | "evm" | "near";
export type DeploymentNetwork = "devnet" | "testnet";
export type DeploymentStatus = "deployed" | "not-deployed" | "coming-soon";

export interface ChainDeployment {
  /** Stable id stored with notes. */
  id: string;
  kind: DeploymentKind;
  name: string;
  network: DeploymentNetwork;
  /** EVM chain id. Absent for Solana and NEAR. */
  chainId?: number;
  rpcUrl: string;
  explorerUrl: string;
  /** Explorer URL with the literal `{tx}` replaced by the transaction id. */
  explorerTxUrl: string;
  faucetUrl: string;
  faucetLabel: string;
  nativeSymbol: string;
  nativeDecimals: number;
  /** Solana program id. Empty until that program is deployed. */
  programId: string;
  /** Solana pool PDA, EVM ShadePool, or empty until deployed. */
  poolAddress: string;
  /** EVM Groth16 verifier. Empty when that chain has no verifier yet. */
  verifierAddress: string;
  /** NEAR account id of the pool contract. Empty on other chains. */
  contractId: string;
}

/** Chain ids that are mainnet, or a public network this app must never configure. */
export const FORBIDDEN_CHAIN_IDS: readonly number[] = [
  1, // Ethereum
  10, // Optimism
  56, // BNB
  137, // Polygon
  999, // HyperEVM
  8453, // Base
  42161, // Arbitrum One
  43114, // Avalanche
  4663, // Robinhood Chain
];

const MAINNET = /mainnet/i;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const DEPLOYMENTS: readonly ChainDeployment[] = [
  {
    id: "solana-devnet",
    kind: "solana",
    name: "Solana devnet",
    network: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    explorerUrl: "https://explorer.solana.com/address/DA56DQtdwGzbSQyy7jLAt76cqnVpW5E6JHg3N7V6DyZF?cluster=devnet",
    explorerTxUrl: "https://explorer.solana.com/tx/{tx}?cluster=devnet",
    faucetUrl: "https://faucet.solana.com",
    faucetLabel: "Solana devnet faucet",
    nativeSymbol: "SOL",
    nativeDecimals: 9,
    programId: "4VnXvKR2pwUio27hG8Q2VHxFj6gFENG6qa4AdqtvobSj",
    poolAddress: "DA56DQtdwGzbSQyy7jLAt76cqnVpW5E6JHg3N7V6DyZF",
    verifierAddress: "",
    contractId: "",
  },
  {
    id: "robinhood-testnet",
    kind: "evm",
    name: "Robinhood Chain testnet",
    network: "testnet",
    chainId: 46630,
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    explorerTxUrl: "https://explorer.testnet.chain.robinhood.com/tx/{tx}",
    faucetUrl: "https://www.alchemy.com/faucets/robinhood-testnet",
    faucetLabel: "Robinhood testnet faucet",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    programId: "",
    poolAddress: "0xd752b0950DD4ad662CFb451Dea2d07b53B047559",
    verifierAddress: "0xaE9645Cd9833A655f0EA3babd41b9b8f615F5D2F",
    contractId: "",
  },
  {
    id: "base-sepolia",
    kind: "evm",
    name: "Base Sepolia",
    network: "testnet",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    explorerTxUrl: "https://sepolia.basescan.org/tx/{tx}",
    faucetUrl: "https://portal.cdp.coinbase.com/products/faucet",
    faucetLabel: "Base Sepolia faucet",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    programId: "",
    poolAddress: "",
    verifierAddress: "",
    contractId: "",
  },
  {
    id: "hyperevm-testnet",
    kind: "evm",
    name: "HyperEVM testnet",
    network: "testnet",
    chainId: 998,
    rpcUrl: "https://rpc.hyperliquid-testnet.xyz/evm",
    explorerUrl: "https://testnet.purrsec.com",
    explorerTxUrl: "https://testnet.purrsec.com/tx/{tx}",
    faucetUrl: "https://faucet.chainstack.com/hyperliquid-testnet-faucet",
    faucetLabel: "HyperEVM testnet faucet",
    nativeSymbol: "HYPE",
    nativeDecimals: 18,
    programId: "",
    poolAddress: "",
    verifierAddress: "",
    contractId: "",
  },
  {
    id: "elysium-testnet",
    kind: "evm",
    name: "Elysium testnet",
    network: "testnet",
    chainId: 99801,
    rpcUrl: "https://testnet-rpc.elysium.kinetiq.xyz",
    explorerUrl: "https://elysium.kinetiq.xyz/testnet-explorer",
    explorerTxUrl: "https://elysium.kinetiq.xyz/testnet-explorer/tx/{tx}",
    faucetUrl: "https://elysium.kinetiq.xyz/testnet-faucet",
    faucetLabel: "Elysium testnet faucet",
    nativeSymbol: "HYPE",
    nativeDecimals: 18,
    programId: "",
    poolAddress: "0xd752b0950DD4ad662CFb451Dea2d07b53B047559",
    verifierAddress: "0xaE9645Cd9833A655f0EA3babd41b9b8f615F5D2F",
    contractId: "",
  },
  {
    id: "near-testnet",
    kind: "near",
    name: "NEAR testnet",
    network: "testnet",
    rpcUrl: "https://rpc.testnet.near.org",
    explorerUrl: "https://testnet.nearblocks.io",
    explorerTxUrl: "https://testnet.nearblocks.io/txns/{tx}",
    faucetUrl: "https://near-faucet.io",
    faucetLabel: "NEAR testnet faucet",
    nativeSymbol: "NEAR",
    nativeDecimals: 24,
    programId: "",
    poolAddress: "",
    verifierAddress: "",
    contractId: "shader-deployer-blie3d.testnet",
  },
];

export function assertDeploymentSafe(chain: ChainDeployment): void {
  if (chain.network !== "devnet" && chain.network !== "testnet") {
    throw new Error(`Refusing ${chain.id}: only devnet and testnet are allowed.`);
  }
  const haystack = [chain.name, chain.rpcUrl, chain.explorerUrl, chain.explorerTxUrl, chain.faucetUrl].join(" ");
  if (MAINNET.test(haystack)) {
    throw new Error(`Refusing ${chain.id}: mainnet endpoints are not allowed.`);
  }
  if (!chain.rpcUrl.startsWith("https://") || !chain.faucetUrl.startsWith("https://")) {
    throw new Error(`Refusing ${chain.id}: RPC and faucet URLs must be https.`);
  }
  if (chain.kind === "evm") {
    if (chain.chainId === undefined) throw new Error(`Refusing ${chain.id}: an EVM testnet needs a chain id.`);
    if (FORBIDDEN_CHAIN_IDS.includes(chain.chainId)) {
      throw new Error(`Refusing ${chain.id}: chain id ${chain.chainId} is mainnet.`);
    }
  } else if (chain.chainId !== undefined) {
    throw new Error(`Refusing ${chain.id}: only EVM testnets use a chain id.`);
  }
  if (!Number.isInteger(chain.nativeDecimals) || chain.nativeDecimals < 0 || chain.nativeDecimals > 24) {
    throw new Error(`Refusing ${chain.id}: token decimals are out of range.`);
  }
}

export function assertDeploymentList(chains: readonly ChainDeployment[]): void {
  const seen = new Set<string>();
  for (const chain of chains) {
    assertDeploymentSafe(chain);
    if (seen.has(chain.id)) throw new Error(`Duplicate chain ${chain.id}.`);
    seen.add(chain.id);
  }
}

export function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isSolanaAddress(value: string): boolean {
  return BASE58.test(value);
}

export function deploymentStatus(chain: ChainDeployment): DeploymentStatus {
  assertDeploymentSafe(chain);
  if (chain.kind === "near") return "coming-soon";
  if (chain.kind === "solana") {
    if (!isSolanaAddress(chain.programId) || !isSolanaAddress(chain.poolAddress)) return "not-deployed";
    return "deployed";
  }
  if (!isEvmAddress(chain.poolAddress)) return "not-deployed";
  if (/^0x0{40}$/i.test(chain.poolAddress)) return "not-deployed";
  return "deployed";
}

export function getDeployment(id: string): ChainDeployment {
  const chain = DEPLOYMENTS.find((item) => item.id === id);
  if (!chain) throw new Error(`Unknown chain ${id}.`);
  return chain;
}

export function explorerTx(chain: ChainDeployment, tx: string): string {
  return chain.explorerTxUrl.replace("{tx}", tx);
}

/** Chain home mixed into a note. Solana is 1001, NEAR is 1002, and an EVM note uses its chain id. */
export function chainHome(chain: ChainDeployment): bigint {
  if (chain.kind === "solana") return EXT_DOMAIN.solana;
  if (chain.kind === "near") return EXT_DOMAIN.near;
  if (chain.chainId === undefined) throw new Error(`${chain.id} has no chain id.`);
  return BigInt(chain.chainId);
}

assertDeploymentList(DEPLOYMENTS);
