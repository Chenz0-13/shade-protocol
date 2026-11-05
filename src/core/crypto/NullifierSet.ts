import { DoubleSpendError } from "../errors.js";

/** In-memory nullifier registry. A chain program must persist the same set. */
export class NullifierSet {
  private readonly spent = new Set<string>();

  private key(nullifier: bigint | string): string {
    return typeof nullifier === "bigint" ? nullifier.toString() : nullifier;
  }

  isSpent(nullifier: bigint | string): boolean {
    return this.spent.has(this.key(nullifier));
  }

  /**
   * Marks a nullifier spent. Returns false when it was already spent so
   * callers can refuse the second spend without throwing, or use `spend`.
   */
  markSpent(nullifier: bigint | string): boolean {
    const key = this.key(nullifier);
    if (this.spent.has(key)) return false;
    this.spent.add(key);
    return true;
  }

  spend(nullifier: bigint | string): void {
    if (!this.markSpent(nullifier)) throw new DoubleSpendError();
  }

  get size(): number {
    return this.spent.size;
  }
}
