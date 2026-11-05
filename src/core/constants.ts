/**
 * Protocol parameters shared by the TypeScript implementation and
 * `circuits/shielded_transfer.circom`. The circuit hardcodes TREE_DEPTH,
 * VALUE_BITS, and the domain tags below; tests fail if they drift.
 *
 * Depth 20 (about 1 million leaves) is still a devnet parameter. The circuit
 * keys come from a single-party development setup. It is not a production tree.
 */
export const TREE_DEPTH = 20;
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
  /** Mixed into the extDataHash binder with the pool address and chain id. */
  ext: 5n,
  /** Output rho is Poseidon(rho, input nullifier, output index). */
  rho: 6n,
  /** Poseidon(asset, assetId), then mixed with the chain tag. */
  asset: 7n,
  order: 8n,
  /** Poseidon(chain, chainHome). */
  chain: 9n,
} as const;

/** Public signals of shielded_transfer.circom, in circom order. */
export const PUBLIC_INPUTS = {
  merkleRoot: 0,
  nullifier: 1,
  commitmentOut1: 2,
  commitmentOut2: 3,
  withdrawAmount: 4,
  relayerFee: 5,
  extDataHash: 6,
  count: 7,
} as const;

export const ASSET_BASE = 1n;
export const ASSET_QUOTE = 2n;
export const SIDE_BUY = 1n;
export const SIDE_SELL = 2n;

/**
 * External-data domains mixed into extDataHash. EVM pools use `block.chainid`
 * (46630 Robinhood testnet, 99801 Elysium testnet) instead of these constants.
 */
export const EXT_DOMAIN = {
  solana: 1001n,
  near: 1002n,
} as const;

export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
export const SOLANA_DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const SOLANA_TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const SOLANA_MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
