import { NotImplementedError } from "../errors.js";
import type { ChainSubmission } from "./solana.js";

export async function submitNear(_payload: ChainSubmission): Promise<never> {
  throw new NotImplementedError("NEAR testnet submission");
}

export async function submitCanton(_payload: ChainSubmission): Promise<never> {
  throw new NotImplementedError("Canton submission");
}

export async function submitRobinhood(_payload: ChainSubmission): Promise<never> {
  throw new NotImplementedError("Robinhood submission");
}
