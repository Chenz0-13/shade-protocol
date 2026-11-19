import { isEvmAddress } from "../app/deployments.js";
import { BN128_FIELD } from "../core/constants.js";
import { limbsFromEvmAddress, extDataHash } from "../core/proof/extData.js";
import type { RelayerChain, RelayRequest } from "./types.js";

const VALUE_LIMIT = 1n << 64n;

export interface AcceptedRelay {
  chain: RelayerChain;
  recipient: `0x${string}`;
  withdrawAmount: bigint;
  relayerFee: bigint;
  nullifier: string;
}

export function validateRelayRequest(
  body: RelayRequest,
  chains: readonly RelayerChain[],
  relayer: string,
): AcceptedRelay {
  const chain = chains.find((item) => item.chainId === body.chainId);
  if (!chain || !chain.enabled) throw new RelayError(400, "That testnet is not enabled on this relayer.");
  if (!isEvmAddress(chain.pool) || /^0x0{40}$/i.test(chain.pool)) {
    throw new RelayError(400, "That testnet has no pool configured.");
  }
  if (!isEvmAddress(body.recipient)) throw new RelayError(400, "The recipient must be an EVM address.");
  if (!Array.isArray(body.publicSignals) || body.publicSignals.length !== 7) {
    throw new RelayError(400, "A shielded transfer has seven public signals.");
  }
  const signals = body.publicSignals.map(parseSignal);
  const withdrawAmount = signals[4]!;
  const relayerFee = signals[5]!;
  if (withdrawAmount >= VALUE_LIMIT || relayerFee >= VALUE_LIMIT) {
    throw new RelayError(400, "The withdraw amount or the fee is out of range.");
  }
  if (relayerFee < chain.fee) throw new RelayError(400, "The relayer fee is below the current quote.");
  const recipient = body.recipient.toLowerCase() as `0x${string}`;
  const [recipientLo, recipientHi] = limbsFromEvmAddress(recipient);
  const [relayerLo, relayerHi] = limbsFromEvmAddress(relayer);
  const [poolLo, poolHi] = limbsFromEvmAddress(chain.pool);
  const expected = extDataHash(
    { recipientLo, recipientHi, relayerLo, relayerHi, poolLo, poolHi, chainDomain: BigInt(chain.chainId) },
    withdrawAmount,
    relayerFee,
  );
  if (signals[6] !== expected) throw new RelayError(400, "The public data does not match this relayer.");
  assertProofShape(body.proof);
  return {
    chain,
    recipient,
    withdrawAmount,
    relayerFee,
    nullifier: body.publicSignals[1]!,
  };
}

export function gasAllowsRelay(gasPrice: bigint, maxGasPrice: bigint, assumedGas: bigint, fee: bigint): boolean {
  if (gasPrice <= 0n || assumedGas <= 0n) return false;
  if (gasPrice > maxGasPrice) return false;
  if (gasPrice * assumedGas > fee) return false;
  return true;
}

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function parseSignal(value: string): bigint {
  if (typeof value !== "string" || !/^(?:0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value)) {
    throw new RelayError(400, "A public signal is not a field element.");
  }
  const parsed = BigInt(value);
  if (parsed >= BN128_FIELD) throw new RelayError(400, "A public signal is outside the field.");
  return parsed;
}

function assertProofShape(proof: RelayRequest["proof"]): void {
  const point = (value: unknown) => typeof value === "string" && /^(?:0x[0-9a-fA-F]{1,96}|[0-9]{1,78})$/.test(value);
  if (!proof || !Array.isArray(proof.pi_a) || !Array.isArray(proof.pi_b) || !Array.isArray(proof.pi_c)) {
    throw new RelayError(400, "The proof is incomplete.");
  }
  if (proof.pi_a.length < 2 || proof.pi_c.length < 2 || proof.pi_b.length < 2) {
    throw new RelayError(400, "The proof is incomplete.");
  }
  const flat = [...proof.pi_a, ...proof.pi_c, ...proof.pi_b.flat()];
  if (!flat.every(point)) throw new RelayError(400, "The proof is incomplete.");
}
