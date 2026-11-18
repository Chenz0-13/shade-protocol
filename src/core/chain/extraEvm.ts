import { createWalletClient, http, type Address, type Chain, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ConfigError } from "../errors.js";
import { shadePoolAbi, solidityProof } from "./robinhood.js";
import type { ChainSubmission } from "./solana.js";

export const HYPEREVM_TESTNET_CHAIN_ID = 998;
export const HYPEREVM_MAINNET_CHAIN_ID = 999;
export const HYPEREVM_TESTNET_RPC = "https://rpc.hyperliquid-testnet.xyz/evm";

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";

export function assertHyperEvmTarget(_rpcUrl: string, chainId: number): void {
  if (chainId === HYPEREVM_MAINNET_CHAIN_ID || chainId !== HYPEREVM_TESTNET_CHAIN_ID) {
    throw new ConfigError(
      `Refusing HyperEVM chain id ${chainId}. Only testnet chain id ${HYPEREVM_TESTNET_CHAIN_ID} is supported.`,
    );
  }
}

export function assertBaseSepoliaTarget(_rpcUrl: string, chainId: number): void {
  if (chainId === BASE_MAINNET_CHAIN_ID || chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new ConfigError(
      `Refusing Base chain id ${chainId}. Only Base Sepolia chain id ${BASE_SEPOLIA_CHAIN_ID} is supported.`,
    );
  }
}

export class EvmTestnetAdapter {
  readonly chainId: number;

  constructor(
    private readonly options: {
      name: string;
      rpcUrl: string;
      chainId: number;
      pool?: Address;
      privateKey?: Hex;
      walletClient?: WalletClient;
      missingPool: string;
      missingKey: string;
    },
  ) {
    this.chainId = options.chainId;
  }

  async shieldedTransfer(
    payload: ChainSubmission,
    recipient: Address,
    relayer: Address = "0x0000000000000000000000000000000000000000",
  ): Promise<{ hash: Hex }> {
    const pool = this.options.pool;
    if (!pool) throw new ConfigError(this.options.missingPool);
    const proof = solidityProof(payload);
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: pool,
      abi: shadePoolAbi,
      functionName: "shieldedTransfer",
      args: [proof.pA, proof.pB, proof.pC, proof.pubSignals, recipient, relayer],
      account: wallet.account!,
      chain: this.chain(),
    });
    return { hash };
  }

  private wallet(): WalletClient {
    if (this.options.walletClient) return this.options.walletClient;
    if (!this.options.privateKey) throw new ConfigError(this.options.missingKey);
    const account = privateKeyToAccount(this.options.privateKey);
    return createWalletClient({ account, chain: this.chain(), transport: http(this.options.rpcUrl) });
  }

  private chain(): Chain {
    return {
      id: this.chainId,
      name: this.options.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [this.options.rpcUrl] } },
    };
  }
}
