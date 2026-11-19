const LOCAL = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/;

export class RpcError extends Error {
  constructor(readonly kind: "unreachable" | "rejected") {
    super(kind);
  }
}

export async function postRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  if (/mainnet/i.test(url)) throw new RpcError("rejected");
  if (!url.startsWith("https://") && !LOCAL.test(url)) throw new RpcError("rejected");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch {
    throw new RpcError("unreachable");
  }
  if (!response.ok) throw new RpcError("unreachable");
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new RpcError("rejected");
  return body.result;
}
