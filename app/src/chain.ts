import "./polyfill.js";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { SOLANA_DEVNET_GENESIS, SOLANA_MAINNET_GENESIS, TREE_DEPTH } from "../../src/core/constants.js";
import { MerkleTree } from "../../src/core/merkle/MerkleTree.js";
import { FORBIDDEN_CHAIN_IDS, type ChainDeployment } from "../../src/app/deployments.js";
import { encodeNullifierQuery, viewCall } from "../../src/app/evmCall.js";
import { solanaNullifierAccount, WITHDRAW_COMPUTE_UNITS } from "../../src/app/instruction.js";
import { insertionsInLog, leavesFromEvmLogs, leavesFromInstruction, readPoolHeader, DEPOSIT_TOPIC, SPENT_TOPIC, type EvmPoolLog } from "../../src/app/leaves.js";
import type { Eip1193, SolanaProvider } from "./wallets.js";

export interface PoolView {
  nextIndex: bigint;
  root: bigint;
  leaves: bigint[];
}

export async function syncSolanaPool(rpcUrl: string, programId: string, poolAddress: string): Promise<PoolView> {
  const connection = devnetConnection(rpcUrl);
  await assertDevnet(connection);
  const pool = new PublicKey(poolAddress);
  const program = new PublicKey(programId);
  const info = await connection.getAccountInfo(pool, "confirmed");
  if (!info) throw new Error("The Solana devnet pool account was not found.");
  const header = readPoolHeader(info.data);
  if (header.nextIndex === 0n) return checkPool(header, []);
  const signatures = await allSignatures(connection, pool);
  const leaves: bigint[] = [];
  const pending = signatures.filter((item) => item.err === null).map((item) => item.signature);
  for (let offset = 0; offset < pending.length; offset += 8) {
    const group = pending.slice(offset, offset + 8);
    const transactions = await Promise.all(
      group.map((signature) =>
        connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
      ),
    );
      group.forEach((_signature, index) => {
      const tx = transactions[index];
      if (!tx) throw new Error("Devnet did not return a pool transaction, so a proof cannot be built safely.");
      if (tx.meta?.err) return;
      const message = tx.transaction.message;
      const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
      for (const instruction of message.compiledInstructions) {
        const owner = keys.get(instruction.programIdIndex);
        if (!owner?.equals(program)) continue;
        leaves.push(...leavesFromInstruction(instruction.data));
      }
    });
  }
  return checkPool(header, leaves);
}

export async function submitSolana(params: {
  rpcUrl: string;
  feePayer: string;
  provider: SolanaProvider;
  instructions: { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: Uint8Array }[];
  computeUnits?: number;
}): Promise<{ hash: string; confirmed: boolean }> {
  const connection = devnetConnection(params.rpcUrl);
  await assertDevnet(connection);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = new PublicKey(params.feePayer);
  transaction.recentBlockhash = blockhash;
  if (params.computeUnits) {
    transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: params.computeUnits }));
  }
  for (const instruction of params.instructions) {
    transaction.add(
      new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.keys.map((key) => ({
          pubkey: new PublicKey(key.pubkey),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data),
      }),
    );
  }
  const signed = await params.provider.signTransaction(transaction);
  const hash = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction(
    { signature: hash, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) throw new Error("The pool rejected the transaction.");
  return { hash, confirmed: true };
}

export function solanaInstruction(params: {
  programId: string;
  payer: string;
  pool: string;
  vault: string;
  data: Uint8Array;
  nullifier?: string;
  recipient?: string;
}): { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: Uint8Array } {
  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: params.pool, isSigner: false, isWritable: true },
    { pubkey: params.vault, isSigner: false, isWritable: true },
  ];
  if (params.nullifier) keys.push({ pubkey: params.nullifier, isSigner: false, isWritable: true });
  if (params.recipient) keys.push({ pubkey: params.recipient, isSigner: false, isWritable: true });
  keys.push({ pubkey: SystemProgram.programId.toBase58(), isSigner: false, isWritable: false });
  return { programId: params.programId, keys, data: params.data };
}

export const SOLANA_WITHDRAW_COMPUTE = WITHDRAW_COMPUTE_UNITS;

export async function isNullifierSpent(chain: ChainDeployment, nullifier: bigint): Promise<boolean> {
  if (chain.kind === "solana") {
    const connection = devnetConnection(chain.rpcUrl);
    const account = solanaNullifierAccount(new PublicKey(chain.programId), nullifier);
    const info = await connection.getAccountInfo(account, "confirmed");
    return info !== null;
  }
  if (!chain.poolAddress) return false;
  const result = await rpc<string>(chain.rpcUrl, "eth_call", [
    { to: chain.poolAddress, data: encodeNullifierQuery(nullifier) },
    "latest",
  ]);
  return BigInt(result || "0x0") === 1n;
}

export async function syncEvmPool(chain: ChainDeployment): Promise<PoolView> {
  if (!chain.poolAddress) throw new Error("This chain does not have a pool yet.");
  const root = await readUint(chain, viewCall("currentRoot()"));
  const nextIndex = await readUint(chain, viewCall("nextIndex()"));
  const logs = await getLogs(chain, nextIndex);
  const leaves = leavesFromEvmLogs(logs);
  return checkPool({ nextIndex, root }, leaves);
}

export async function ensureEvmChain(provider: Eip1193, chain: ChainDeployment): Promise<void> {
  if (chain.chainId === undefined) throw new Error("This chain is not an EVM testnet.");
  if (FORBIDDEN_CHAIN_IDS.includes(chain.chainId)) throw new Error("Refusing a mainnet chain id.");
  const current = await evmChainId(provider);
  if (FORBIDDEN_CHAIN_IDS.includes(current)) throw new Error("The wallet is on a mainnet. This app will not continue.");
  if (current === chain.chainId) return;
  const chainId = `0x${chain.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: chain.nativeDecimals },
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: [chain.explorerUrl],
        },
      ],
    });
  }
  const after = await evmChainId(provider);
  if (after !== chain.chainId || FORBIDDEN_CHAIN_IDS.includes(after)) {
    throw new Error("The wallet is not on the selected testnet.");
  }
}

export async function sendEvm(params: {
  provider: Eip1193;
  chain: ChainDeployment;
  from: string;
  data: string;
  value: bigint;
}): Promise<{ hash: string; confirmed: boolean }> {
  await ensureEvmChain(params.provider, params.chain);
  const hash = (await params.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: params.from,
        to: params.chain.poolAddress,
        data: params.data,
        value: `0x${params.value.toString(16)}`,
      },
    ],
  })) as string;
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const receipt = await rpc<null | { status?: string }>(params.chain.rpcUrl, "eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("The pool rejected the transaction.");
      return { hash, confirmed: true };
    }
    await delay(2_000);
  }
  return { hash, confirmed: false };
}

async function evmChainId(provider: Eip1193): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return Number(hex);
}

async function readUint(chain: ChainDeployment, data: string): Promise<bigint> {
  const result = await rpc<string>(chain.rpcUrl, "eth_call", [{ to: chain.poolAddress, data }, "latest"]);
  if (!result || result === "0x") throw new Error("The pool did not answer.");
  return BigInt(result);
}

/** Robinhood's public RPC rejects eth_getLogs ranges wider than 100000 blocks. */
const LOG_WINDOW = 90_000n;

async function getLogs(chain: ChainDeployment, nextIndex: bigint): Promise<EvmPoolLog[]> {
  if (nextIndex === 0n) return [];
  const tip = BigInt(await rpc<string>(chain.rpcUrl, "eth_blockNumber", []));
  const collected: EvmPoolLog[] = [];
  let seen = 0n;
  let end = tip;
  while (seen < nextIndex) {
    const start = end >= LOG_WINDOW ? end - LOG_WINDOW + 1n : 0n;
    const batch = await rpc<
      { topics: string[]; data: string; blockNumber: string; transactionIndex: string; logIndex: string }[]
    >(chain.rpcUrl, "eth_getLogs", [
      {
        address: chain.poolAddress,
        fromBlock: `0x${start.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
        topics: [[`0x${DEPOSIT_TOPIC}`, `0x${SPENT_TOPIC}`]],
      },
    ]);
    for (const log of batch) {
      const mapped = {
        topic0: log.topics[0] ?? "",
        topic1: log.topics[1] ?? "",
        data: log.data,
        blockNumber: Number(log.blockNumber),
        transactionIndex: Number(log.transactionIndex),
        logIndex: Number(log.logIndex),
      };
      collected.push(mapped);
      seen += BigInt(insertionsInLog(mapped.topic0));
    }
    if (start === 0n) break;
    end = start - 1n;
  }
  return collected;
}

function checkPool(header: { nextIndex: bigint; root: bigint }, leaves: bigint[]): PoolView {
  if (header.nextIndex > 1n << BigInt(TREE_DEPTH)) throw new Error("This devnet pool is full.");
  if (BigInt(leaves.length) !== header.nextIndex) {
    throw new Error("The pool history this browser read does not match the pool, so a proof would be rejected.");
  }
  const tree = MerkleTree.empty(TREE_DEPTH);
  for (const leaf of leaves) tree.insert(leaf);
  if (tree.root() !== header.root) {
    throw new Error("The pool history this browser read does not match the pool, so a proof would be rejected.");
  }
  return { nextIndex: header.nextIndex, root: header.root, leaves };
}

function devnetConnection(rpcUrl: string): Connection {
  if (/mainnet/i.test(rpcUrl)) throw new Error("Refusing a Solana mainnet RPC.");
  return new Connection(rpcUrl, "confirmed");
}

async function assertDevnet(connection: Connection): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (genesis === SOLANA_MAINNET_GENESIS) throw new Error("Refusing Solana mainnet.");
  if (genesis !== SOLANA_DEVNET_GENESIS) throw new Error("The configured RPC is not Solana devnet.");
}

async function allSignatures(connection: Connection, pool: PublicKey) {
  const signatures = [];
  let before: string | undefined;
  for (;;) {
    const page = await connection.getSignaturesForAddress(pool, { before, limit: 1000 });
    signatures.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1]?.signature;
    if (!before || signatures.length > 5_000) {
      throw new Error("This pool has more history than the browser will scan.");
    }
  }
  return signatures.reverse();
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
