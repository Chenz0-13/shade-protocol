import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_RPC, HYPEREVM_TESTNET_CHAIN_ID, HYPEREVM_TESTNET_RPC } from "../core/chain/extraEvm.js";
import { ELYSIUM_TESTNET_CHAIN_ID, ELYSIUM_TESTNET_RPC } from "../core/chain/elysium.js";
import { NEAR_TESTNET_RPC } from "../core/chain/near.js";
import { ROBINHOOD_TESTNET_CHAIN_ID, ROBINHOOD_TESTNET_RPC } from "../core/chain/robinhood.js";
import { EXT_DOMAIN, SOLANA_DEVNET_GENESIS, SOLANA_DEVNET_RPC, SOLANA_TESTNET_GENESIS } from "../core/constants.js";

export interface ChainRecord {
  id: string;
  kind: "evm" | "solana" | "near";
  chainId?: number;
  chainHome: bigint;
  rpc: string;
  genesis?: string;
  testnet: true;
}

/** Testnet and devnet chains only. There is no mainnet record in this registry. */
export const CHAIN_REGISTRY: readonly ChainRecord[] = [
  {
    id: "robinhood-testnet",
    kind: "evm",
    chainId: ROBINHOOD_TESTNET_CHAIN_ID,
    chainHome: BigInt(ROBINHOOD_TESTNET_CHAIN_ID),
    rpc: ROBINHOOD_TESTNET_RPC,
    testnet: true,
  },
  {
    id: "elysium-testnet",
    kind: "evm",
    chainId: ELYSIUM_TESTNET_CHAIN_ID,
    chainHome: BigInt(ELYSIUM_TESTNET_CHAIN_ID),
    rpc: ELYSIUM_TESTNET_RPC,
    testnet: true,
  },
  {
    id: "hyperevm-testnet",
    kind: "evm",
    chainId: HYPEREVM_TESTNET_CHAIN_ID,
    chainHome: BigInt(HYPEREVM_TESTNET_CHAIN_ID),
    rpc: HYPEREVM_TESTNET_RPC,
    testnet: true,
  },
  {
    id: "base-sepolia",
    kind: "evm",
    chainId: BASE_SEPOLIA_CHAIN_ID,
    chainHome: BigInt(BASE_SEPOLIA_CHAIN_ID),
    rpc: BASE_SEPOLIA_RPC,
    testnet: true,
  },
  {
    id: "solana-devnet",
    kind: "solana",
    chainHome: EXT_DOMAIN.solana,
    rpc: SOLANA_DEVNET_RPC,
    genesis: SOLANA_DEVNET_GENESIS,
    testnet: true,
  },
  {
    id: "solana-testnet",
    kind: "solana",
    chainHome: EXT_DOMAIN.solana,
    rpc: "https://api.testnet.solana.com",
    genesis: SOLANA_TESTNET_GENESIS,
    testnet: true,
  },
  {
    id: "near-testnet",
    kind: "near",
    chainHome: EXT_DOMAIN.near,
    rpc: NEAR_TESTNET_RPC,
    testnet: true,
  },
];

const MAINNET_EVM = new Set([1, 8453, 999, 4663]);

export function chainById(id: string): ChainRecord {
  const found = CHAIN_REGISTRY.find((item) => item.id === id);
  if (!found) throw new Error(`unknown testnet chain ${id}`);
  return found;
}

export function assertNotMainnetChainId(chainId: number): void {
  if (MAINNET_EVM.has(chainId) || !CHAIN_REGISTRY.some((item) => item.chainId === chainId)) {
    throw new Error(`chain id ${chainId} is not a configured testnet`);
  }
}
