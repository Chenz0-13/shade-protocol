import { defineChain, http, type Address, type Chain, type Hex, type PublicClient, type WalletClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ConfigError } from "../errors.js";
import { shadePoolAbi, solidityProof } from "./robinhood.js";
import type { ChainSubmission } from "./solana.js";

/** Kinetiq Elysium testnet. viem's `elysiumTestnet` is chain id 1338 and is a different network. */
export const ELYSIUM_TESTNET_CHAIN_ID = 99801;
export const ELYSIUM_TESTNET_RPC = "https://testnet-rpc.elysium.kinetiq.xyz";

export const elysiumTestnet: Chain = defineChain({
  id: ELYSIUM_TESTNET_CHAIN_ID,
  name: "Kinetiq Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [ELYSIUM_TESTNET_RPC] } },
  blockExplorers: {
    default: { name: "Elysium Explorer", url: "https://elysium.kinetiq.xyz/testnet-explorer" },
  },
});

export function assertElysiumTarget(rpcUrl: string, chainId: number): void {
  if (rpcUrl.toLowerCase().includes("mainnet") || chainId !== ELYSIUM_TESTNET_CHAIN_ID) {
    throw new ConfigError(
      `Refusing Kinetiq Elysium chain id ${chainId}. Only testnet chain id ${ELYSIUM_TESTNET_CHAIN_ID} is supported. Mainnet is pre-launch.`,
    );
  }
}

/**
 * Elysium testnet reuses the EVM ShadePool. The native gas token is HYPE.
 */
export class ElysiumTestnetAdapter {
  readonly chainId: number;

  constructor(
    private readonly options: {
      rpcUrl: string;
      chainId: number;
      pool?: Address;
      privateKey?: Hex;
      publicClient?: PublicClient;
      walletClient?: WalletClient;
    },
  ) {
    assertElysiumTarget(options.rpcUrl, options.chainId);
    this.chainId = options.chainId;
  }

  async shieldedTransfer(
    payload: ChainSubmission,
    recipient: Address,
    relayer: Address = "0x0000000000000000000000000000000000000000",
  ): Promise<{ hash: Hex }> {
    const pool = this.options.pool;
    if (!pool) {
      throw new ConfigError(
        "ELYSIUM_POOL is required. Deploy contracts/evm to Elysium testnet. Refusing to report a transfer.",
      );
    }
    const proof = solidityProof(payload);
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: pool,
      abi: shadePoolAbi,
      functionName: "shieldedTransfer",
      args: [proof.pA, proof.pB, proof.pC, proof.pubSignals, recipient, relayer],
      account: wallet.account!,
      chain: elysiumTestnet,
    });
    return { hash };
  }

  private wallet(): WalletClient {
    if (this.options.walletClient) return this.options.walletClient;
    if (!this.options.privateKey) {
      throw new ConfigError("ELYSIUM_PRIVATE_KEY is required to submit. Refusing to invent a transaction hash.");
    }
    const account = privateKeyToAccount(this.options.privateKey);
    return createWalletClient({ account, chain: elysiumTestnet, transport: http(this.options.rpcUrl) });
  }
}
