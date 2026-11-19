import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { encodeShieldedTransferCall } from "../app/evmCall.js";
import { postRpc, RpcError } from "./rpc.js";
import type { InfoResponse, RelayRequest, RelayerChain, StatusResponse } from "./types.js";
import { RelayError, gasAllowsRelay, validateRelayRequest } from "./validate.js";

const MAX_BODY = 48 * 1024;

export interface RelayerOptions {
  chains: readonly RelayerChain[];
  privateKey: `0x${string}`;
  verify: (proof: RelayRequest["proof"], publicSignals: string[]) => Promise<boolean>;
  maxGasPrice: bigint;
  assumedGas: bigint;
  ratePerMinute?: number;
  maxBodyBytes?: number;
  rpc?: (url: string, method: string, params: unknown[]) => Promise<unknown>;
  log?: (event: { status: string; chainId?: number; id?: string; tx?: string }) => void;
}

export function createRelayer(options: RelayerOptions): ReturnType<typeof createServer> {
  const account = privateKeyToAccount(options.privateKey);
  const jobs = new Map<string, StatusResponse>();
  const nullifiers = new Set<string>();
  const hits: number[] = [];
  const locks = new Map<number, Promise<void>>();
  const call = options.rpc ?? postRpc;
  const log = options.log ?? defaultLog;
  const rate = options.ratePerMinute ?? 30;
  const maxBody = options.maxBodyBytes ?? MAX_BODY;

  async function enqueue<T>(chainId: number, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(chainId) ?? Promise.resolve();
    const run = previous.then(task, task);
    locks.set(
      chainId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  return createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const status = error instanceof RelayError ? error.status : 500;
      const message = error instanceof RelayError ? error.message : "The relayer could not complete that request.";
      send(res, status, { error: message });
      log({ status: "error" });
    });

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
      setCors(response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://relayer.local");
      if (request.method === "GET" && url.pathname === "/v1/info") {
        send(response, 200, await info());
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/status/")) {
        const id = url.pathname.slice("/v1/status/".length);
        if (!/^[0-9a-f-]{36}$/.test(id)) throw new RelayError(404, "Unknown relay.");
        const job = jobs.get(id);
        if (!job) throw new RelayError(404, "Unknown relay.");
        send(response, 200, job);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/relay") {
        const declared = Number(request.headers["content-length"] ?? "0");
        if (Number.isFinite(declared) && declared > maxBody) throw new RelayError(413, "The request is too large.");
        if (!allow(hits, rate)) throw new RelayError(429, "Too many relay requests. Wait a minute and try again.");
        const body = parseJson(await readBody(request, maxBody));
        const accepted = validateRelayRequest(body, options.chains, account.address);
        if (nullifiers.has(accepted.nullifier)) throw new RelayError(409, "This note is already being relayed.");
        const ok = await options.verify(body.proof, body.publicSignals);
        if (!ok) throw new RelayError(400, "The proof does not verify.");
        nullifiers.add(accepted.nullifier);
        try {
          const txHash = await enqueue(accepted.chain.chainId, async () => submit(accepted.chain, body, accepted.recipient));
          const id = crypto.randomUUID();
          const job: StatusResponse = { id, status: "submitted", chainId: accepted.chain.chainId, txHash };
          remember(jobs, job);
          log({ status: "submitted", chainId: job.chainId, id, tx: txHash });
          send(response, 202, job);
          void watch(accepted.chain, id, txHash, accepted.nullifier);
        } catch (error) {
          nullifiers.delete(accepted.nullifier);
          throw error;
        }
        return;
      }
      throw new RelayError(404, "Unknown route.");
    }

    async function info(): Promise<InfoResponse> {
      const chains = await Promise.all(
        options.chains.map(async (chain) => {
          let accepting = false;
          if (chain.enabled) {
            try {
              accepting = gasAllowsRelay(await gasPrice(chain), options.maxGasPrice, options.assumedGas, chain.fee);
            } catch {
              accepting = false;
            }
          }
          return {
            chainId: chain.chainId,
            name: chain.name,
            enabled: chain.enabled,
            accepting,
            pool: chain.pool,
            fee: chain.fee.toString(),
            symbol: chain.symbol,
          };
        }),
      );
      return { relayer: account.address, chains };
    }

    async function submit(chain: RelayerChain, body: RelayRequest, recipient: `0x${string}`): Promise<string> {
      const price = await gasPrice(chain);
      if (!gasAllowsRelay(price, options.maxGasPrice, options.assumedGas, chain.fee)) {
        throw new RelayError(503, "Gas is above the fee quote, so the relayer is paused on this chain.");
      }
      const reported = BigInt(String(await rpc(chain, "eth_chainId", [])));
      if (reported !== BigInt(chain.chainId)) throw new RelayError(503, "The RPC reported a different chain.");
      const data = encodeShieldedTransferCall({
        proof: body.proof,
        publicSignals: body.publicSignals,
        recipient,
        relayer: account.address,
      });
      await rpc(chain, "eth_call", [{ from: account.address, to: chain.pool, data }, "latest"]);
      const nonce = Number(BigInt(String(await rpc(chain, "eth_getTransactionCount", [account.address, "pending"]))));
      const signed = await account.signTransaction({
        chainId: chain.chainId,
        to: chain.pool as Hex,
        data: data as Hex,
        gas: options.assumedGas,
        gasPrice: price,
        nonce,
        value: 0n,
        type: "legacy",
      });
      const txHash = await rpc(chain, "eth_sendRawTransaction", [signed]);
      if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new RelayError(503, "The testnet did not return a transaction.");
      }
      return txHash;
    }

    async function watch(chain: RelayerChain, id: string, txHash: string, nullifier: string): Promise<void> {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await delay(1_000);
        const receipt = await rpc(chain, "eth_getTransactionReceipt", [txHash]).catch(() => null);
        if (!receipt || typeof receipt !== "object") continue;
        const status = (receipt as { status?: string }).status;
        const job = jobs.get(id);
        if (!job) return;
        if (status === "0x1") {
          jobs.set(id, { ...job, status: "confirmed" });
          log({ status: "confirmed", chainId: chain.chainId, id, tx: txHash });
          return;
        }
        if (status === "0x0") {
          jobs.set(id, { ...job, status: "failed" });
          nullifiers.delete(nullifier);
          log({ status: "failed", chainId: chain.chainId, id, tx: txHash });
          return;
        }
      }
    }

    async function gasPrice(chain: RelayerChain): Promise<bigint> {
      return BigInt(String(await rpc(chain, "eth_gasPrice", [])));
    }

    async function rpc(chain: RelayerChain, method: string, params: unknown[]): Promise<unknown> {
      try {
        return await call(chain.rpcUrl, method, params);
      } catch (error) {
        if (error instanceof RelayError) throw error;
        if (error instanceof RpcError && error.kind === "rejected" && method === "eth_call") {
          throw new RelayError(400, "The pool would reject this transaction.");
        }
        throw new RelayError(503, "The testnet RPC did not answer.");
      }
    }
  });
}

function allow(hits: number[], rate: number): boolean {
  const now = Date.now();
  while (hits.length > 0 && now - hits[0]! > 60_000) hits.shift();
  if (hits.length >= rate) return false;
  hits.push(now);
  return true;
}

function remember(jobs: Map<string, StatusResponse>, job: StatusResponse): void {
  jobs.set(job.id, job);
  if (jobs.size <= 1_000) return;
  const oldest = jobs.keys().next().value;
  if (oldest) jobs.delete(oldest);
}

function parseJson(text: string): RelayRequest {
  try {
    const body = JSON.parse(text) as RelayRequest;
    if (!body || typeof body !== "object") throw new Error("not an object");
    return body;
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError(400, "The request body is not valid JSON.");
  }
}

async function readBody(request: IncomingMessage, max: number): Promise<string> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > max) throw new RelayError(413, "The request is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > max) throw new RelayError(413, "The request is too large.");
    chunks.push(buf);
  }
  try {
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    throw new RelayError(400, "The request body is not valid JSON.");
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

function setCors(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function defaultLog(event: { status: string; chainId?: number; id?: string; tx?: string }): void {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
