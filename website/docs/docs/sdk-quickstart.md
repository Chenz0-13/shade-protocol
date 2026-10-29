# SDK quickstart (Solana devnet)

> **API subject to change.** Shade Protocol is pre-release, unaudited software running on **devnet only**, with **development trusted-setup keys that are not secure**. Use throwaway keys and valueless devnet tokens. The method names below describe the target `ShadeClient` API; check the repository's `src/sdk/` and examples for the current signatures. *TODO (owner): re-run every snippet against the merged SDK and fix any drift before publishing.*

## 1. Install

The package is not yet published to npm. Build from source:

```bash
git clone https://github.com/Chenz0-13/shade-protocol.git
cd shade-protocol
npm ci
npm run build          # compiles the SDK
npm run circuits:dev   # builds circuit WASM + dev zkey (TODO owner: confirm script name)
npm test
```

In your own project:

```bash
npm install /path/to/shade-protocol   # or `npm link`
```

*TODO (owner): add the npm package name once published.*

You will also need a funded Solana devnet wallet:

```bash
solana-keygen new -o ~/.config/solana/devnet.json
solana airdrop 2 --url devnet
```

## 2. Create a client

```ts
import { ShadeClient } from "shade-protocol";
import { Keypair, Connection } from "@solana/web3.js";
import fs from "node:fs";

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/devnet.json", "utf8")))
);

const client = new ShadeClient({
  chain: "solana",
  network: "devnet",
  rpcUrl: "https://api.devnet.solana.com",
  programId: process.env.SHADE_PROGRAM_ID!,     // TODO (owner): publish the devnet program ID
  circuits: {
    wasmPath: "./build/transaction_js/transaction.wasm",
    zkeyPath: "./build/transaction_dev.zkey",     // DEV SETUP — not secure
    vkeyPath: "./build/transaction_vkey.json",
  },
});

await client.init();
```

## 3. Keys and your shielded address

```ts
// Generate once and store securely. Losing the spending key loses funds.
const keys = await client.keys.generate();
// { spendingKey, viewingKey, address: "shade1..." }

// Later:
const restored = await client.keys.fromSeed(seedBytes);
client.useKeys(restored);

console.log("Shielded address:", restored.address);
```

The address encodes $(pk, V)$ — see [cryptography.md](cryptography.md#2-keys-and-addresses). It is safe to share; it never appears on-chain.

## 4. Deposit (shield)

```ts
const { signature, note } = await client.deposit({
  asset: "SOL",          // or an SPL mint address
  amount: 500_000_000n,  // 0.5 SOL in lamports
  payer,                 // public wallet the funds come from
});
console.log("Deposited:", signature, "leaf", note.leafIndex);
```

A deposit links your public wallet to the *fact* that you deposited this amount. What you do afterwards is hidden.

## 5. Sync and check your balance

```ts
await client.sync();                       // scans new commitments, trial-decrypts with your view key
const balance = await client.balance("SOL");
const notes = await client.notes.list({ asset: "SOL", unspent: true });
```

## 6. Private transfer

```ts
const { signature } = await client.transfer({
  to: "shade1qxy...recipient",   // recipient's shielded address
  asset: "SOL",
  amount: 100_000_000n,
  relayer: undefined,            // optionally a relayer URL so your public wallet doesn't pay gas
});
```

The SDK selects input notes, creates a recipient note and a change note, encrypts both, proves locally and submits. Proving typically takes a few seconds; *TODO (owner): add measured times*.

## 7. Withdraw (unshield)

```ts
await client.withdraw({
  asset: "SOL",
  amount: 200_000_000n,
  recipient: "9xQe...publicSolanaAddress",
  relayer: "https://relayer.devnet.example",   // TODO (owner): real devnet relayer URL, if any
});
```

Withdrawing straight after depositing the same amount makes the link obvious. Waiting and using round amounts helps.

## 8. Dark-pool order

```ts
const { orderId } = await client.darkPool.submitOrder({
  pair: "SOL/USDC-dev",
  side: "buy",
  size: 1_000_000_000n,     // 1 SOL (base units)
  limitPrice: 150_000_000n, // quote units per 1 base, with pair decimals
  expiresIn: 3600,          // seconds
});

client.darkPool.on("filled", (e) => console.log("Filled", e.orderId, e.fillSize));
await client.darkPool.cancel(orderId);
```

See [dark-pool.md](dark-pool.md) for matching rules and the matcher trust model.

## 9. Compliance helpers (optional)

```ts
// Prove a KYC credential to a pool that requires it
const kycProof = await client.compliance.proveCredential({
  credential,                 // issued off-chain by an issuer
  minLevel: 2,
  jurisdictionSet,            // provided by the pool policy
});

// Produce a scoped disclosure bundle for your accountant
const bundle = await client.compliance.createDisclosure({
  from: new Date("2026-07-01"),
  to: new Date("2026-09-30"),
  assets: ["SOL"],
  encryptTo: accountantPublicKey,
});

// Register a screening provider (no-op by default)
client.compliance.registerScreeningProvider(myProvider);
```

Details in [compliance.md](compliance.md).

## 10. Other chains

```ts
new ShadeClient({ chain: "near", network: "testnet", /* ... */ });  // in progress
```

NEAR, Canton and Robinhood adapters may be incomplete or absent in the current build. Calls to an unavailable adapter throw `AdapterNotAvailableError` rather than pretending to succeed. *TODO (owner): confirm error name.*

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Unknown root` | Your local tree is stale — call `client.sync()` and retry |
| `Nullifier already spent` | The note was spent in another transaction; resync |
| Proof generation very slow | Use Node rather than a mobile browser; ensure WASM and zkey paths are local |
| Balance shows zero after deposit | Not yet synced, or wrong viewing key |
