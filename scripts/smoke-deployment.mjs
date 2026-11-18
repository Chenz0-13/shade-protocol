/**
 * Post-deploy smoke test: deposit, then withdraw with a real Groth16 proof.
 *
 * Refuses to send anything unless SHADE_BROADCAST=1. Refuses mainnet by chain id.
 * The pool must still be empty (EVM nextIndex == 0, or the NEAR root still the
 * empty depth-20 root). The proof is built for that first leaf.
 *
 * EVM:
 *   SHADE_BROADCAST=1 SMOKE_RPC_URL=... SMOKE_PRIVATE_KEY=... SMOKE_POOL=0x... \
 *     node scripts/smoke-deployment.mjs --chain evm
 *
 * NEAR:
 *   SHADE_BROADCAST=1 NEAR_RPC_URL=... NEAR_ACCOUNT_ID=... NEAR_PRIVATE_KEY=... \
 *     NEAR_CONTRACT_ID=... SMOKE_RECIPIENT=alice.testnet \
 *     node scripts/smoke-deployment.mjs --chain near
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import { poseidon2 } from "poseidon-lite";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVM_TESTNETS = new Set([31337, 46630, 99801, 998, 84532]);
const NEAR_TESTNETS = new Set(["testnet", "localnet", "sandbox"]);
const DEPTH = 20;

const poolAbi = [
  {
    type: "function",
    name: "nextIndex",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "minDeposit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "blinding", type: "uint256" },
      { name: "rho", type: "uint256" },
      { name: "ownerPub", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "shieldedTransfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pA", type: "uint256[2]" },
      { name: "pB", type: "uint256[2][2]" },
      { name: "pC", type: "uint256[2]" },
      { name: "pubSignals", type: "uint256[7]" },
      { name: "recipient", type: "address" },
      { name: "relayer", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nullifiers",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
];

if (process.env.SHADE_BROADCAST !== "1") {
  process.stderr.write(
    "Refusing to broadcast. Set SHADE_BROADCAST=1 after reading docs/deploy.md. No transaction was sent.\n",
  );
  process.exit(0);
}

const chain = argument("--chain");
if (chain !== "evm" && chain !== "near") {
  fail("Pass --chain evm or --chain near.");
}

try {
  if (chain === "evm") await smokeEvm();
  else await smokeNear();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function smokeEvm() {
  const rpc = required("SMOKE_RPC_URL");
  const pool = getAddress(required("SMOKE_POOL"));
  const account = privateKeyToAccount(normalizeKey(required("SMOKE_PRIVATE_KEY")));
  const recipient = getAddress(process.env.SMOKE_RECIPIENT ?? "0x000000000000000000000000000000000000bEEF");
  const client = createPublicClient({ transport: http(rpc) });
  const chainId = await client.getChainId();
  if (!EVM_TESTNETS.has(chainId)) {
    fail(
      `Refusing chain id ${chainId}. Shader smoke runs on Robinhood Chain testnet (46630), Elysium testnet (99801), HyperEVM testnet (998), Base Sepolia (84532), or local anvil (31337).`,
    );
  }
  const evmChain = defineChain({
    id: chainId,
    name: "shader-testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const wallet = createWalletClient({ account, chain: evmChain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain: evmChain, transport: http(rpc) });
  const nextIndex = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: "nextIndex" });
  if (nextIndex !== 0n) {
    fail(`Pool ${pool} nextIndex is ${nextIndex}. The smoke proof is for an empty tree.`);
  }
  const minDeposit = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: "minDeposit" });
  const proof = prove([
    "--pool",
    pool,
    "--recipient-hex",
    recipient,
    "--relayer-hex",
    account.address,
    "--domain",
    String(chainId),
  ]);
  const value = BigInt(proof.value);
  if (value < minDeposit) fail(`Proof value ${value} is below the pool minimum ${minDeposit}.`);
  const depositHash = await wallet.writeContract({
    address: pool,
    abi: poolAbi,
    functionName: "deposit",
    args: [BigInt(proof.blinding), BigInt(proof.rho), BigInt(proof.owner)],
    value,
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
  const withdrawHash = await wallet.writeContract({
    address: pool,
    abi: poolAbi,
    functionName: "shieldedTransfer",
    args: [asPair(proof.pA), asQuad(proof.pB), asPair(proof.pC), asSeven(proof.pub), recipient, account.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
  if (receipt.status !== "success") fail("Withdraw transaction reverted.");
  const spent = await publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "nullifiers",
    args: [BigInt(proof.nullifier)],
  });
  if (!spent) fail("Withdraw mined but the nullifier is not spent.");
  process.stdout.write(
    `EVM smoke passed on chain ${chainId}. deposit ${depositHash} withdraw ${withdrawHash}\n`,
  );
}

async function smokeNear() {
  const rpc = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
  const accountId = required("NEAR_ACCOUNT_ID");
  const contractId = required("NEAR_CONTRACT_ID");
  const recipient = required("SMOKE_RECIPIENT");
  const secret = parseNearSecret(required("NEAR_PRIVATE_KEY"));
  const chainId = await nearChainId(rpc);
  if (chainId === "mainnet") fail("Refusing NEAR mainnet chain id.");
  if (!NEAR_TESTNETS.has(chainId)) fail(`Refusing NEAR chain id ${chainId}.`);
  const root = JSON.parse(await nearView(rpc, contractId, "root", {}));
  if (root !== emptyRoot()) {
    fail(`Contract ${contractId} root is not the empty tree. The smoke proof is for the first leaf.`);
  }
  const proof = prove([
    "--recipient-account",
    recipient,
    "--relayer-account",
    accountId,
    "--pool-account",
    contractId,
    "--domain",
    "1002",
  ]);
  const publicKey = ed25519.getPublicKey(secret);
  const access = await nearQuery(rpc, {
    request_type: "view_access_key",
    finality: "final",
    account_id: accountId,
    public_key: `ed25519:${bs58.encode(publicKey)}`,
  });
  let nonce = BigInt(access.nonce) + 1n;
  const blockHash = bs58.decode(access.block_hash);
  if (blockHash.length !== 32) fail("NEAR access key query did not return a 32-byte block hash.");

  const deposit = await submitNear({
    rpc,
    accountId,
    secret,
    publicKey,
    contractId,
    methodName: "deposit",
    args: { blinding: proof.blinding, rho: proof.rho, owner: proof.owner },
    gas: 300_000_000_000_000n,
    deposit: BigInt(proof.value),
    nonce,
    blockHash,
  });
  nonce += 1n;
  const withdraw = await submitNear({
    rpc,
    accountId,
    secret,
    publicKey,
    contractId,
    methodName: "shielded_transfer",
    args: {
      proof_json: JSON.stringify(proof.snarkjs),
      public_inputs: proof.pub,
      recipient,
    },
    gas: 1_000_000_000_000_000n,
    deposit: 0n,
    nonce,
    blockHash,
  });
  const spent = JSON.parse(await nearView(rpc, contractId, "nullifier_spent", { nullifier: proof.nullifier }));
  if (spent !== true) fail("NEAR withdraw returned but the nullifier is not spent.");
  process.stdout.write(`NEAR smoke passed on ${chainId}. deposit ${deposit} withdraw ${withdraw}\n`);
}

function prove(args) {
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "evm-proof.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    fail(`Could not build the Groth16 proof.\n${run.stderr ?? ""}`);
  }
  return JSON.parse(run.stdout);
}

function emptyRoot() {
  let node = 0n;
  for (let level = 0; level < DEPTH; level += 1) node = poseidon2([node, node]);
  return node.toString();
}

function asPair(values) {
  return [BigInt(values[0]), BigInt(values[1])];
}

function asQuad(values) {
  return [asPair(values[0]), asPair(values[1])];
}

function asSeven(values) {
  return values.map((item) => BigInt(item));
}

async function nearChainId(rpc) {
  const status = await nearRpc(rpc, "status", []);
  const chainId = status.chain_id;
  if (!chainId) fail("NEAR status did not include a chain id.");
  return chainId;
}

async function nearView(rpc, accountId, methodName, args) {
  const result = await nearQuery(rpc, {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return Buffer.from(result.result).toString("utf8");
}

async function nearQuery(rpc, params) {
  return nearRpc(rpc, "query", params);
}

async function nearRpc(rpc, method, params) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "shade", method, params }),
  });
  const parsed = await response.json();
  if (parsed.error) fail(parsed.error.message ?? `NEAR ${method} failed`);
  return parsed.result;
}

async function submitNear(params) {
  const signed = signFunctionCall(params);
  const result = await nearRpc(params.rpc, "broadcast_tx_commit", [signed.toString("base64")]);
  const status = result.status ?? {};
  if (status.Failure || status.failure) {
    fail(`${params.methodName} failed: ${JSON.stringify(status.Failure ?? status.failure)}`);
  }
  const hash = result.transaction?.hash;
  if (!hash) fail(`${params.methodName} did not return a transaction hash.`);
  return hash;
}

function signFunctionCall(params) {
  const args = Buffer.from(JSON.stringify(params.args));
  const tx = Buffer.concat([
    borshString(params.accountId),
    Buffer.from([0]),
    Buffer.from(params.publicKey),
    u64(params.nonce),
    borshString(params.contractId),
    Buffer.from(params.blockHash),
    u32(1),
    Buffer.from([2]),
    borshString(params.methodName),
    u32(args.length),
    args,
    u64(params.gas),
    u128(params.deposit),
  ]);
  const signature = ed25519.sign(sha256(tx), params.secret);
  return Buffer.concat([tx, Buffer.from([0]), signature]);
}

function parseNearSecret(value) {
  const trimmed = value.trim().replace(/^ed25519:/, "");
  const bytes = /^[0-9a-fA-F]+$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(bs58.decode(trimmed));
  if (bytes.length === 64) return bytes.subarray(0, 32);
  if (bytes.length === 32) return bytes;
  fail("NEAR_PRIVATE_KEY must be 32 or 64 bytes.");
}

function normalizeKey(value) {
  const hex = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) fail("SMOKE_PRIVATE_KEY must be 32 bytes hex.");
  return hex;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) return "";
  return process.argv[index + 1];
}

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") fail(`Set ${name}. Refusing to send a transaction without it.`);
  return value.trim();
}

function borshString(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
}

function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function u128(value) {
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(value & ((1n << 64n) - 1n), 0);
  out.writeBigUInt64LE(value >> 64n, 8);
  return out;
}

function fail(message) {
  let text = String(message);
  for (const name of ["SMOKE_PRIVATE_KEY", "NEAR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]) {
    const secret = process.env[name];
    if (secret && secret.length > 0) text = text.split(secret).join("[redacted]");
  }
  process.stderr.write(`${text}\n`);
  process.exit(1);
}
