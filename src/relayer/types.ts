import type { Groth16ProofJson } from "../app/instruction.js";

/** What the browser posts. The relayer address is not chosen here; the proof must bind this service. */
export interface RelayRequest {
  chainId: number;
  recipient: `0x${string}` | string;
  proof: Groth16ProofJson;
  publicSignals: string[];
}

export interface RelayChainInfo {
  chainId: number;
  name: string;
  enabled: boolean;
  accepting: boolean;
  pool: string;
  fee: string;
  symbol: string;
}

export interface InfoResponse {
  relayer: string;
  chains: RelayChainInfo[];
}

export type RelayStatus = "submitted" | "confirmed" | "failed";

export interface StatusResponse {
  id: string;
  status: RelayStatus;
  chainId: number;
  txHash: string;
}

export interface RelayerChain {
  chainId: number;
  name: string;
  rpcUrl: string;
  pool: string;
  enabled: boolean;
  fee: bigint;
  symbol: string;
  decimals: number;
}
