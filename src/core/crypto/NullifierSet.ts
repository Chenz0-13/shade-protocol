export class NullifierSet {
  private spent: Set<string>;

  constructor() {
    this.spent = new Set();
  }

  isSpent(nullifier: bigint | string): boolean {
    return this.spent.has(typeof nullifier === "bigint" ? nullifier.toString() : nullifier);
  }

  markSpent(nullifier: bigint | string): boolean {
    const key = typeof nullifier === "bigint" ? nullifier.toString() : nullifier;
    if (this.spent.has(key)) {
      return false;
    }
    this.spent.add(key);
    return true;
  }
}
