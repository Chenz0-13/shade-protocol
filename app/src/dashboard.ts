import { formatAmount } from "../../src/app/amount.js";
import { deploymentStatus, type ChainDeployment, DEPLOYMENTS } from "../../src/app/deployments.js";
import { viewCall } from "../../src/app/evmCall.js";
import { hexWords, insertionsInLog } from "../../src/app/leaves.js";
import { privacyEstimate } from "../../src/app/privacy.js";
import { fetchEvmPoolLogs, readSolanaPoolHeader } from "./chain.js";

export interface Pulse {
  height: string;
  gas: string | null;
  age: string | null;
}

export interface PoolCard {
  notes: bigint | null;
  tvl: bigint | null;
  rows: Array<{ kind: string; amount: string; state: string }>;
}

const samples: number[] = [];

export async function readPulse(chain: ChainDeployment): Promise<Pulse> {
  if (chain.kind === "solana") return solanaPulse(chain.rpcUrl);
  if (chain.kind === "near") return nearPulse(chain.rpcUrl);
  return evmPulse(chain.rpcUrl);
}

export async function readPoolCard(chain: ChainDeployment): Promise<PoolCard> {
  if (deploymentStatus(chain) !== "deployed") return { notes: null, tvl: null, rows: [] };
  if (chain.kind === "evm") return evmPool(chain);
  if (chain.kind === "solana") {
    const header = await readSolanaPoolHeader(chain.rpcUrl, chain.poolAddress);
    return { notes: header.nextIndex, tvl: null, rows: [] };
  }
  return { notes: null, tvl: null, rows: [] };
}

export async function probeChains(): Promise<Array<{ id: string; name: string; block: string; state: string }>> {
  return Promise.all(
    DEPLOYMENTS.map(async (chain) => {
      try {
        const pulse = await readPulse(chain);
        const status = deploymentStatus(chain);
        const state = status === "coming-soon" ? "Soon" : status === "deployed" ? "Live" : "No pool";
        return { id: chain.id, name: shortName(chain), block: pulse.height, state };
      } catch {
        return { id: chain.id, name: shortName(chain), block: "—", state: "Unreachable" };
      }
    }),
  );
}

export function paintPulse(pulse: Pulse | null): void {
  const label = document.querySelector("#pulse-height");
  const meta = document.querySelector("#pulse-meta");
  if (label) label.textContent = pulse ? `#${pulse.height}` : "—";
  if (meta) meta.textContent = `Last block ${pulse?.age ?? "—"} · Gas ${pulse?.gas ?? "—"}`;
  const svg = document.querySelector<SVGSVGElement>("#pulse-chart");
  const line = svg?.querySelector("polyline");
  if (!line) return;
  if (samples.length < 2) {
    line.setAttribute("points", "");
    return;
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = Math.max(1, max - min);
  const points = samples.map((value, index) => {
    const x = (index / (samples.length - 1)) * 240;
    const y = 56 - ((value - min) / span) * 40;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  line.setAttribute("points", points.join(" "));
}

export function paintPool(card: PoolCard | null, decimals: number, symbol: string): void {
  const notes = document.querySelector("#pool-notes");
  const tvl = document.querySelector("#pool-tvl");
  const ring = document.querySelector<SVGCircleElement>("#pool-ring");
  const count = card?.notes ?? null;
  if (notes) notes.textContent = count === null ? "—" : count.toString();
  if (tvl) {
    tvl.textContent = card?.tvl === null || card?.tvl === undefined ? "—" : displayAmount(card.tvl, decimals, symbol);
  }
  if (ring) {
    const length = 2 * Math.PI * 52;
    const filled = count === null ? 0 : Math.min(1, Number(count > 64n ? 64n : count) / 64);
    ring.style.strokeDasharray = `${(length * filled).toFixed(1)} ${length.toFixed(1)}`;
  }
  const estimate = privacyEstimate(count);
  const score = document.querySelector("#privacy-score");
  const scoreText = document.querySelector("#privacy-note");
  if (score) score.textContent = estimate.score === null ? "—" : String(estimate.score);
  if (scoreText) scoreText.textContent = estimate.text;
  const list = document.querySelector("#activity-list");
  if (!list) return;
  list.replaceChildren();
  if (!card || card.rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = count === null ? "—" : "No pool events in the windows we read.";
    list.append(empty);
    return;
  }
  for (const row of card.rows.slice(-6).reverse()) {
    const item = document.createElement("div");
    item.className = "activity-row";
    const name = document.createElement("b");
    name.textContent = row.kind;
    const amount = document.createElement("span");
    amount.textContent = row.amount;
    const state = document.createElement("small");
    state.textContent = row.state;
    item.append(name, amount, state);
    list.append(item);
  }
}

export function paintChains(
  rows: Array<{ id: string; name: string; block: string; state: string }>,
  selected: string,
): void {
  const root = document.querySelector("#chain-probes");
  if (!root) return;
  root.replaceChildren();
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "probe bolt-source";
    button.dataset.chain = row.id;
    button.setAttribute("aria-pressed", row.id === selected ? "true" : "false");
    const name = document.createElement("b");
    name.textContent = row.name;
    const block = document.createElement("small");
    block.textContent = row.block === "—" ? "—" : `#${row.block}`;
    const badge = document.createElement("span");
    badge.textContent = row.state;
    button.append(name, block, badge);
    root.append(button);
  }
}

export function rememberHeight(height: string): void {
  const digits = height.replace(/,/g, "");
  if (!/^\d+$/.test(digits)) return;
  const value = Number(digits);
  if (!Number.isFinite(value)) return;
  samples.push(value);
  if (samples.length > 16) samples.shift();
}

async function evmPulse(rpcUrl: string): Promise<Pulse> {
  const heightHex = await rpc<string>(rpcUrl, "eth_blockNumber", []);
  const block = await rpc<{ timestamp?: string } | null>(rpcUrl, "eth_getBlockByNumber", [heightHex, false]);
  const gas = await rpc<string>(rpcUrl, "eth_gasPrice", []);
  return {
    height: group(BigInt(heightHex)),
    gas: `${formatAmount(BigInt(gas) / 10_000_000n, 2)} gwei`,
    age: ageFromHex(block?.timestamp),
  };
}

async function solanaPulse(rpcUrl: string): Promise<Pulse> {
  const slot = await rpc<number>(rpcUrl, "getSlot", [{ commitment: "confirmed" }]);
  const time = await rpc<number | null>(rpcUrl, "getBlockTime", [slot]);
  return { height: group(BigInt(slot)), gas: null, age: time === null ? null : ageFromSeconds(time) };
}

async function nearPulse(rpcUrl: string): Promise<Pulse> {
  const status = await rpc<{ sync_info?: { latest_block_height?: number; latest_block_time?: string } }>(rpcUrl, "status", []);
  const height = status.sync_info?.latest_block_height;
  const time = status.sync_info?.latest_block_time;
  return {
    height: height === undefined ? "—" : group(BigInt(height)),
    gas: null,
    age: time ? ageFromSeconds(Math.floor(Date.parse(time) / 1000)) : null,
  };
}

async function evmPool(chain: ChainDeployment): Promise<PoolCard> {
  const nextIndex = BigInt(await rpc<string>(chain.rpcUrl, "eth_call", [{ to: chain.poolAddress, data: viewCall("nextIndex()") }, "latest"]));
  const logs = await fetchEvmPoolLogs(chain, nextIndex);
  let deposits = 0n;
  let paid = 0n;
  const rows: PoolCard["rows"] = [];
  const ordered = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  for (const log of ordered) {
    if (insertionsInLog(log.topic0) === 1) {
      const value = hexWords(log.data)[0] ?? 0n;
      deposits += value;
      rows.push({ kind: "Shield", amount: displayAmount(value, chain.nativeDecimals, chain.nativeSymbol), state: "Confirmed" });
    } else if (insertionsInLog(log.topic0) === 2) {
      const words = hexWords(log.data);
      const withdraw = words[2] ?? 0n;
      const fee = words[3] ?? 0n;
      paid += withdraw + fee;
      rows.push({
        kind: withdraw > 0n ? "Withdraw" : "Private send",
        amount: withdraw > 0n ? displayAmount(withdraw, chain.nativeDecimals, chain.nativeSymbol) : "Hidden",
        state: "Confirmed",
      });
    }
  }
  return { notes: nextIndex, tvl: deposits - paid, rows };
}

function displayAmount(value: bigint, decimals: number, symbol: string): string {
  const text = formatAmount(value, decimals);
  if (/^0\.0{6,}/.test(text)) return `${value.toString()} base units`;
  return `${text} ${symbol}`;
}

function ageFromHex(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  return ageFromSeconds(Number(BigInt(timestamp)));
}

function ageFromSeconds(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return null;
  const age = Math.max(0, Math.floor(Date.now() / 1000 - seconds));
  if (age < 90) return `${age}s ago`;
  return `${Math.floor(age / 60)}m ago`;
}

function group(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function shortName(chain: ChainDeployment): string {
  if (chain.id.startsWith("robinhood")) return "Robinhood";
  if (chain.id.startsWith("elysium")) return "Elysium";
  if (chain.id.startsWith("hyper")) return "HyperEVM";
  if (chain.id.startsWith("base")) return "Base";
  if (chain.id.startsWith("solana")) return "Solana";
  return "NEAR";
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  if (/mainnet/i.test(url)) throw new Error("Refusing a mainnet RPC.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("The testnet RPC did not answer.");
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "The testnet RPC returned an error.");
  return body.result as T;
}
