/**
 * A rough score from the number of notes in the pool.
 * It is an estimate for the dashboard, not a privacy guarantee.
 */
export function privacyEstimate(notes: bigint | null): { score: number | null; text: string } {
  if (notes === null) {
    return { score: null, text: "Estimate. Waiting for the pool note count." };
  }
  if (notes <= 0n) {
    return { score: 0, text: "Estimate. An empty pool does not hide a payment." };
  }
  const capped = notes > 1_000_000n ? 1_000_000 : Number(notes);
  const score = Math.max(1, Math.min(99, Math.round(12 + Math.log2(capped) * 11)));
  return { score, text: "Estimate from the pool note count. Not a privacy guarantee." };
}
