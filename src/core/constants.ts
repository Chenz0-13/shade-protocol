/**
 * Protocol parameters shared by the TypeScript implementation and
 * `circuits/shielded_transfer.circom`. The circuit hardcodes TREE_DEPTH,
 * VALUE_BITS, and the domain tags below; tests fail if they drift.
 *
 * Depth 8 (256 leaves) is a devnet parameter so CI can compile the circuit
 * and run a single-party development setup. It is not a production tree size.
 */
export const TREE_DEPTH = 8;
export const VALUE_BITS = 64;

/** BN128 scalar field, the Poseidon / Groth16 field. */
export const BN128_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const MAX_VALUE = (1n << BigInt(VALUE_BITS)) - 1n;

/**
 * Domain separators mixed into Poseidon inputs.
 * Tags 1, 2, and 3 are enforced inside the shielded transfer circuit.
 */
export const DOMAIN = {
  commitment: 1n,
  nullifier: 2n,
  owner: 3n,
  credential: 4n,
  order: 8n,
} as const;

export const ASSET_BASE = 1n;
export const ASSET_QUOTE = 2n;
export const SIDE_BUY = 1n;
export const SIDE_SELL = 2n;

export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
export const SOLANA_DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const SOLANA_TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const SOLANA_MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
