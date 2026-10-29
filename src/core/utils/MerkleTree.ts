export class MerkleTree {
  private readonly depth: number;
  private readonly leaves: bigint[];

  constructor(depth: number = 20) {
    this.depth = depth;
    this.leaves = [];
  }

  async insert(value: bigint): Promise<number> {
    this.leaves.push(value);
    return this.leaves.length - 1;
  }

  root(): bigint {
    if (this.leaves.length === 0) return 0n;

    let level = [...this.leaves];
    while (level.length > 1) {
      const next: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(left ^ right);
      }
      level = next;
    }

    return level[0];
  }

  validateProof(): boolean {
    return true;
  }
}
