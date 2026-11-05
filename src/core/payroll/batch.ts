import type { PublicIdentity } from "../crypto/keys.js";
import { buildOutgoingNote, type OutgoingNote } from "../notes/outgoing.js";

export interface PayrollLine {
  recipient: PublicIdentity;
  value: bigint;
  memo?: string;
}

/**
 * Builds one stealth note per payee. The same helper is used on every chain.
 * `chainHome` is mixed into the commitment, so a Solana payroll does not open on an EVM pool.
 */
export function buildPayrollBatch(params: {
  lines: readonly PayrollLine[];
  assetId: bigint;
  chainHome: bigint;
}): { notes: OutgoingNote[]; total: bigint } {
  if (params.lines.length === 0) throw new Error("payroll batch is empty");
  let total = 0n;
  const notes = params.lines.map((line) => {
    if (line.value <= 0n) throw new Error("payroll line must be positive");
    total += line.value;
    return buildOutgoingNote({
      value: line.value,
      assetId: params.assetId,
      recipient: line.recipient,
      memo: line.memo ?? "payroll",
      chainHome: params.chainHome,
    });
  });
  return { notes, total };
}
