import type { Groth16ProofJson } from "../../src/app/instruction.js";
import type { InfoResponse, StatusResponse } from "../../src/relayer/types.js";

export interface RelayerQuote {
  url: string;
  relayer: string;
  fee: bigint;
}

export function relayerBase(): string {
  const typed = document.querySelector<HTMLInputElement>("#relayer-url")?.value.trim() ?? "";
  const built = typed || (import.meta.env.VITE_RELAYER_URL ?? "").trim();
  return built.replace(/\/$/, "");
}

export async function fetchRelayerQuote(chainId: number): Promise<RelayerQuote> {
  const url = relayerBase();
  if (!url) throw new Error("Enter the relayer URL, or turn off Use relayer to submit from your wallet.");
  const response = await fetch(`${url}/v1/info`);
  if (!response.ok) throw new Error("The relayer did not answer.");
  const info = (await response.json()) as InfoResponse;
  const row = info.chains.find((item) => item.chainId === chainId);
  if (!row?.enabled) throw new Error("This testnet is not enabled on the relayer.");
  if (!row.accepting) throw new Error("The relayer is paused because gas is above its fee quote.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(info.relayer)) throw new Error("The relayer address was not usable.");
  return { url, relayer: info.relayer, fee: BigInt(row.fee) };
}

export async function submitRelay(params: {
  url: string;
  chainId: number;
  recipient: string;
  proof: Groth16ProofJson;
  publicSignals: string[];
}): Promise<StatusResponse> {
  const response = await fetch(`${params.url}/v1/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainId: params.chainId,
      recipient: params.recipient,
      proof: params.proof,
      publicSignals: params.publicSignals,
    }),
  });
  const body = (await response.json()) as StatusResponse & { error?: string };
  if (!response.ok) throw new Error(body.error || "The relayer rejected the proof.");
  return body;
}

export async function waitForRelay(url: string, id: string, onUpdate: (status: string) => void): Promise<StatusResponse> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${url}/v1/status/${id}`);
    if (response.ok) {
      const body = (await response.json()) as StatusResponse;
      onUpdate(body.status);
      if (body.status === "confirmed" || body.status === "failed") return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("The relayer has not finished yet. Check the explorer before spending this note again.");
}
