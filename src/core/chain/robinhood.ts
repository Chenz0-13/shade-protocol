import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ConfigError } from "../errors.js";
import type { ChainSubmission } from "./solana.js";

export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;
export const ROBINHOOD_MAINNET_CHAIN_ID = 4663;
export const ROBINHOOD_TESTNET_RPC = "https://rpc.testnet.chain.robinhood.com";
export const ANVIL_CHAIN_ID = 31337;

const poolAbi = parseAbi([
  "function deposit(uint256 blinding, uint256 rho, uint256 ownerPub) payable returns (uint256)",
  "function shieldedTransfer(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[5] pubSignals, address recipient) external",
  "function currentRoot() view returns (uint256)",
  "function nullifiers(uint256) view returns (bool)",
]);

export function assertRobinhoodTarget(rpcUrl: string, chainId: number): void {
  const lower = rpcUrl.toLowerCase();
  if (chainId === ROBINHOOD_MAINNET_CHAIN_ID || lower.includes("mainnet")) {
    throw new ConfigError(
      "Refusing Robinhood Chain mainnet (chain id 4663). Use the testnet RPC and chain id 46630, or a local anvil chain.",
    );
  }
  const local = chainId === ANVIL_CHAIN_ID || chainId === 1337;
  if (!local && chainId !== ROBINHOOD_TESTNET_CHAIN_ID) {
    throw new ConfigError(`Robinhood chain id ${chainId} is not the testnet or a local anvil chain.`);
  }
}

export function solidityProof(payload: ChainSubmission): {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
  pubSignals: [bigint, bigint, bigint, bigint, bigint];
} {
  const pub = [payload.merkleRoot, payload.nullifier, payload.commitmentOut1, payload.commitmentOut2, payload.fee].map(
    (value) => BigInt(value),
  ) as [bigint, bigint, bigint, bigint, bigint];
  return {
    pA: [BigInt(payload.proof.pi_a[0]!), BigInt(payload.proof.pi_a[1]!)],
    pB: [
      [BigInt(payload.proof.pi_b[0]![1]!), BigInt(payload.proof.pi_b[0]![0]!)],
      [BigInt(payload.proof.pi_b[1]![1]!), BigInt(payload.proof.pi_b[1]![0]!)],
    ],
    pC: [BigInt(payload.proof.pi_c[0]!), BigInt(payload.proof.pi_c[1]!)],
    pubSignals: pub,
  };
}

/**
 * Robinhood Chain is an Arbitrum Orbit EVM. This adapter calls the ShadePool
 * contract. It does not talk to the Robinhood broker API.
 */
export class RobinhoodTestnetAdapter {
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
    assertRobinhoodTarget(options.rpcUrl, options.chainId);
    this.chainId = options.chainId;
  }

  async shieldedTransfer(payload: ChainSubmission, recipient: Address): Promise<{ hash: Hex }> {
    const pool = this.options.pool;
    if (!pool) {
      throw new ConfigError(
        "ROBINHOOD_POOL is required. Deploy contracts/evm to Robinhood Chain testnet. Refusing to report a transfer.",
      );
    }
    const proof = solidityProof(payload);
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: pool,
      abi: poolAbi,
      functionName: "shieldedTransfer",
      args: [proof.pA, proof.pB, proof.pC, proof.pubSignals, recipient],
      account: wallet.account!,
      chain: this.chain(),
    });
    return { hash };
  }

  async deposit(params: { blinding: bigint; rho: bigint; ownerPub: bigint; value: bigint }): Promise<{ hash: Hex }> {
    const pool = this.options.pool;
    if (!pool) throw new ConfigError("ROBINHOOD_POOL is required.");
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: pool,
      abi: poolAbi,
      functionName: "deposit",
      args: [params.blinding, params.rho, params.ownerPub],
      value: params.value,
      account: wallet.account!,
      chain: this.chain(),
    });
    return { hash };
  }

  private wallet(): WalletClient {
    if (this.options.walletClient) return this.options.walletClient;
    if (!this.options.privateKey) {
      throw new ConfigError("ROBINHOOD_PRIVATE_KEY is required to submit. Refusing to invent a transaction hash.");
    }
    const account = privateKeyToAccount(this.options.privateKey);
    return createWalletClient({ account, chain: this.chain(), transport: http(this.options.rpcUrl) });
  }

  private chain(): Chain {
    return {
      id: this.chainId,
      name: this.chainId === ROBINHOOD_TESTNET_CHAIN_ID ? "Robinhood Chain Testnet" : "Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [this.options.rpcUrl] } },
    };
  }

  static publicClient(rpcUrl: string, chainId: number): PublicClient {
    assertRobinhoodTarget(rpcUrl, chainId);
    return createPublicClient({ transport: http(rpcUrl) });
  }
}
