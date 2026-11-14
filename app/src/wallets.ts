import { hexToBytes } from "../../src/core/crypto/field.js";
import { VAULT_MESSAGE } from "../../src/app/vault.js";

export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
  providers?: Eip1193[];
}

export interface SolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey: { toBase58(): string } | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
  signMessage: (message: Uint8Array, display?: "utf8") => Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction: (transaction: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>;
}

export interface NamedProvider<T> {
  name: string;
  provider: T;
}

interface BrowserWalletWindow {
  ethereum?: Eip1193 & { isMetaMask?: boolean; isRabby?: boolean; isPhantom?: boolean; providers?: Eip1193[] };
  phantom?: { ethereum?: Eip1193 & { isPhantom?: boolean }; solana?: SolanaProvider };
  solana?: SolanaProvider;
  solflare?: SolanaProvider;
}

export function listEvmProviders(): NamedProvider<Eip1193>[] {
  const browser = window as unknown as BrowserWalletWindow;
  const found: NamedProvider<Eip1193>[] = [];
  const candidates = [
    ...(browser.ethereum?.providers ?? []),
    browser.ethereum,
    browser.phantom?.ethereum,
  ];
  const seen = new Set<object>();
  for (const provider of candidates) {
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    found.push({ name: evmName(provider), provider });
  }
  return found;
}

export function listSolanaProviders(): NamedProvider<SolanaProvider>[] {
  const browser = window as unknown as BrowserWalletWindow;
  const found: NamedProvider<SolanaProvider>[] = [];
  const phantom = browser.phantom?.solana ?? (browser.solana?.isPhantom ? browser.solana : undefined);
  if (phantom) found.push({ name: "Phantom", provider: phantom });
  if (browser.solflare && browser.solflare !== phantom) found.push({ name: "Solflare", provider: browser.solflare });
  if (!phantom && browser.solana && browser.solana !== browser.solflare) {
    found.push({ name: browser.solana.isSolflare ? "Solflare" : "Solana wallet", provider: browser.solana });
  }
  return found;
}

export async function connectEvm(provider: Eip1193): Promise<string> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (!account) throw new Error("The wallet did not share an address.");
  return account;
}

export async function signEvm(provider: Eip1193, address: string): Promise<Uint8Array> {
  const signature = (await provider.request({
    method: "personal_sign",
    params: [VAULT_MESSAGE, address],
  })) as string;
  return hexToBytes(signature.startsWith("0x") ? signature.slice(2) : signature);
}

export async function connectSolana(provider: SolanaProvider): Promise<string> {
  const connected = await provider.connect();
  const address = connected.publicKey?.toBase58() ?? provider.publicKey?.toBase58();
  if (!address) throw new Error("The wallet did not share an address.");
  return address;
}

export async function signSolana(provider: SolanaProvider): Promise<Uint8Array> {
  const result = await provider.signMessage(new TextEncoder().encode(VAULT_MESSAGE), "utf8");
  if (result instanceof Uint8Array) return result;
  if (result.signature instanceof Uint8Array) return result.signature;
  throw new Error("The wallet did not return a signature.");
}

function evmName(provider: { isRabby?: boolean; isPhantom?: boolean; isMetaMask?: boolean }): string {
  if (provider.isRabby) return "Rabby";
  if (provider.isPhantom) return "Phantom";
  if (provider.isMetaMask) return "MetaMask";
  return "EVM wallet";
}
