# Shade Protocol

Shade Protocol is a privacy-first protocol stack for shielded notes, compliant dark-pool matching, and chain-agnostic execution. This repository is a buildable project scaffold that unifies the TypeScript privacy engine, cryptography primitives, KYC compliance layer, chain adapters, and proof infrastructure.

## Repository layout

- `src/core` — privacy engine, cryptography, pool logic, nullifier registry, compliance
- `src/sdk` — client surface for chain-agnostic shielding and pool submission
- `chains/` — chain adapter stubs for Solana, NEAR, Canton, Robinhood
- `circuits/` — ZK circuit sources and placeholders
- `infra/` — deployment and relayer scaffolding
- `tests/` — unit/integration/e2e placeholders

## Getting started

```bash
npm install
npm run build
npm test
```

## Project status

This repo is intentionally organized as a functioning TypeScript scaffold for a privacy-first protocol stack. It includes:

- cryptographic primitives for shielded notes and encrypted values
- Merkle-tree and nullifier registry primitives
- a dark-pool matching engine shell
- a ZK compliance / KYC proof layer
- a unified SDK client
- chain and infra placeholders

## Important note

Production deployment requires:

- real verifier integration
- production-grade cryptography review
- compiled Circom/Noir proving artifacts
- secure key management
- runtime compliance controls

## Usage

```ts
import { ShadeClient } from "./src/sdk/ShadeClient.js";

const client = new ShadeClient({
  chains: ["solana", "near"],
  solanaRpc: process.env.SOLANA_RPC,
  nearNetwork: "testnet",
});

await client.init();
```
