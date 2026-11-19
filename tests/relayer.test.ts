import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { extDataHash, limbsFromEvmAddress } from "../src/core/proof/extData.js";
import { chainsFromDeployments, loadConfig } from "../src/relayer/config.js";
import { createRelayer, type RelayerOptions } from "../src/relayer/server.js";
import type { RelayRequest, RelayerChain } from "../src/relayer/types.js";
import { gasAllowsRelay, validateRelayRequest } from "../src/relayer/validate.js";

const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const RELAYER = privateKeyToAccount(ANVIL_KEY).address;
const POOL = "0x000000000000000000000000000000000000dEaD";
const RECIPIENT = "0x00000000000000000000000000000000000000bb";

function chain(fee = 1000n): RelayerChain {
  return {
    chainId: 31337,
    name: "Anvil",
    rpcUrl: "http://127.0.0.1:8545",
    pool: POOL,
    enabled: true,
    fee,
    symbol: "ETH",
    decimals: 18,
  };
}

function request(fee = 1000n, withdraw = 5n): RelayRequest {
  const [recipientLo, recipientHi] = limbsFromEvmAddress(RECIPIENT);
  const [relayerLo, relayerHi] = limbsFromEvmAddress(RELAYER);
  const [poolLo, poolHi] = limbsFromEvmAddress(POOL);
  const hash = extDataHash(
    { recipientLo, recipientHi, relayerLo, relayerHi, poolLo, poolHi, chainDomain: 31337n },
    withdraw,
    fee,
  );
  return {
    chainId: 31337,
    recipient: RECIPIENT,
    proof: { pi_a: ["1", "2", "1"], pi_b: [["3", "4"], ["5", "6"], ["1", "0"]], pi_c: ["7", "8", "1"] },
    publicSignals: ["1", "42", "3", "4", withdraw.toString(), fee.toString(), hash.toString()],
  };
}

describe("relayer validation", () => {
  it("rejects a fee below the quote and a proof bound to someone else", () => {
    expect(() => validateRelayRequest(request(1n), [chain()], RELAYER).relayerFee).toThrow(/below the current quote/);
    const other = request();
    other.publicSignals = [...other.publicSignals.slice(0, 5), "1", other.publicSignals[6]!];
    expect(() => validateRelayRequest(other, [chain(1n)], RELAYER)).toThrow(/does not match this relayer/);
    const accepted = validateRelayRequest(request(), [chain()], RELAYER);
    expect(accepted.relayerFee).toBe(1000n);
    expect(accepted.withdrawAmount).toBe(5n);
  });

  it("keeps the fee above the gas it is willing to pay", () => {
    expect(gasAllowsRelay(1_000_000_000n, 20_000_000_000n, 2_000_000n, 1_000_000_000_000_000n)).toBe(false);
    expect(gasAllowsRelay(1_000_000n, 20_000_000_000n, 2_000_000n, 1_000_000_000_000_000n)).toBe(true);
    expect(gasAllowsRelay(50_000_000_000n, 20_000_000_000n, 2_000_000n, 10n ** 18n)).toBe(false);
  });

  it("configures the live testnets and leaves the others disabled", () => {
    const chains = chainsFromDeployments({ RELAYER_PRIVATE_KEY: ANVIL_KEY }, 10n);
    expect(chains.map((item) => [item.chainId, item.enabled])).toEqual([
      [46630, true],
      [99801, true],
      [998, false],
      [84532, false],
    ]);
    expect(chains.find((item) => item.chainId === 46630)?.pool).toBe("0xd752b0950DD4ad662CFb451Dea2d07b53B047559");
    expect(() => loadConfig({})).toThrow(/RELAYER_PRIVATE_KEY/);
  });
});

describe("relayer http", () => {
  const logs: string[] = [];
  const sent: string[] = [];
  let server: ReturnType<typeof createRelayer>;
  let base = "";

  function options(extra: Partial<RelayerOptions> = {}): RelayerOptions {
    return {
      chains: [chain(), { ...chain(), chainId: 84532, name: "Base Sepolia", enabled: false, pool: "" }],
      privateKey: ANVIL_KEY,
      maxGasPrice: 20_000_000_000n,
      assumedGas: 1n,
      verify: async () => true,
      log: (event) => logs.push(JSON.stringify(event)),
      rpc: async (_url, method, params) => {
        if (method === "eth_chainId") return "0x7a69";
        if (method === "eth_gasPrice") return "0x1";
        if (method === "eth_call") return "0x";
        if (method === "eth_getTransactionCount") return "0x0";
        if (method === "eth_sendRawTransaction") {
          sent.push(String(params[0]));
          return `0x${"ab".repeat(32)}`;
        }
        if (method === "eth_getTransactionReceipt") return { status: "0x1" };
        throw new Error(method);
      },
      ...extra,
    };
  }

  afterAll(() => server?.close());

  it("quotes, submits, and confirms without logging the proof", async () => {
    server = createRelayer(options());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const info = (await fetch(`${base}/v1/info`).then((response) => response.json())) as {
      relayer: string;
      chains: Array<{ chainId: number; enabled: boolean; accepting: boolean; fee: string }>;
    };
    expect(info.relayer).toBe(RELAYER);
    expect(info.chains.find((item) => item.chainId === 31337)).toMatchObject({ enabled: true, accepting: true, fee: "1000" });
    expect(info.chains.find((item) => item.chainId === 84532)?.enabled).toBe(false);

    const posted = await fetch(`${base}/v1/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request()),
    });
    expect(posted.status).toBe(202);
    const job = (await posted.json()) as { id: string; status: string; txHash: string };
    expect(job.status).toBe("submitted");
    expect(sent).toHaveLength(1);
    let status = job.status;
    for (let attempt = 0; attempt < 10 && status !== "confirmed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const body = (await fetch(`${base}/v1/status/${job.id}`).then((response) => response.json())) as { status: string };
      status = body.status;
    }
    expect(status).toBe("confirmed");
    expect(logs.join("\n")).not.toContain(RECIPIENT);
    expect(logs.join("\n")).not.toContain(ANVIL_KEY);

    const low = await fetch(`${base}/v1/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request(1n)),
    });
    expect(low.status).toBe(400);
    const paused = createRelayer(options({ maxGasPrice: 0n }));
    await new Promise<void>((resolve) => paused.listen(0, "127.0.0.1", resolve));
    const pausedBase = `http://127.0.0.1:${(paused.address() as AddressInfo).port}`;
    const pausedPost = await fetch(`${pausedBase}/v1/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request(1000n, 9n)),
    });
    expect(pausedPost.status).toBe(503);
    paused.close();
  });

  it("limits request size and request rate", async () => {
    const limited = createRelayer(options({ maxBodyBytes: 2_000, ratePerMinute: 1 }));
    await new Promise<void>((resolve) => limited.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/v1/relay`;
    const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request(1000n, 8n)) });
    const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request(1000n, 7n)) });
    const huge = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "3000" },
      body: "x".repeat(3_000),
    });
    expect([first.status, second.status].sort()).toEqual([202, 429]);
    expect(huge.status).toBe(413);
    limited.close();
  });
});

function anvilOnPath(): boolean {
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("relayer on anvil", () => {
  const child: ChildProcess[] = [];
  afterAll(() => {
    for (const proc of child) proc.kill();
  });

  it.skipIf(!anvilOnPath())("submits a transaction to a local anvil chain", async () => {
    const port = 18545;
    const proc = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--silent"], { stdio: "ignore" });
    child.push(proc);
    const rpc = `http://127.0.0.1:${port}`;
    await waitFor(rpc);
    const server = createRelayer({
      chains: [{ ...chain(1_000_000_000_000_000_000n), rpcUrl: rpc }],
      privateKey: ANVIL_KEY,
      maxGasPrice: 100_000_000_000n,
      assumedGas: 100_000n,
      verify: async () => true,
      log: () => undefined,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const posted = await fetch(`${base}/v1/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request(1_000_000_000_000_000_000n, 4n)),
    });
    expect(posted.status).toBe(202);
    const job = (await posted.json()) as { id: string; txHash: string };
    let status = "submitted";
    for (let attempt = 0; attempt < 20 && status !== "confirmed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const body = (await fetch(`${base}/v1/status/${job.id}`).then((response) => response.json())) as { status: string };
      status = body.status;
    }
    expect(status).toBe("confirmed");
    const receipt = (await rpcCall(rpc, "eth_getTransactionReceipt", [job.txHash])) as { status?: string; to?: string };
    expect(receipt.status).toBe("0x1");
    expect(receipt.to?.toLowerCase()).toBe(POOL.toLowerCase());
    server.close();
  });
});

async function waitFor(rpc: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rpcCall(rpc, "eth_chainId", []);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("anvil did not start");
}

async function rpcCall(rpc: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || method);
  return body.result;
}
