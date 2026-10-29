import { TREE_DEPTH } from "../constants.js";
import { assertField } from "../crypto/field.js";
import { poseidon } from "../crypto/poseidon.js";

export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
}

/**
 * Fixed-depth Poseidon Merkle tree. Empty subtrees use the standard zero
 * hashes: zeros[0] = 0 and zeros[i+1] = Poseidon(zeros[i], zeros[i]).
 * Proofs have exactly `depth` siblings. Verification recomputes the root.
 */
export function zeroHashes(depth: number): bigint[] {
  const zeros: bigint[] = [0n];
  for (let level = 0; level < depth; level += 1) {
    zeros.push(poseidon([zeros[level]!, zeros[level]!]));
  }
  return zeros;
}

/**
 * On-chain frontier tree. `filled[level]` is the left node waiting for a
 * right sibling. This matches `MerkleTree` roots so a proof built from the
 * full tree verifies against the frontier root the contracts store.
 */
export class IncrementalMerkleTree {
  readonly zeros: bigint[];
  private readonly filled: bigint[];
  private nextIndex = 0;
  private currentRoot: bigint;

  constructor(readonly depth: number) {
    this.zeros = zeroHashes(depth);
    this.filled = this.zeros.slice(0, depth);
    this.currentRoot = this.zeros[depth]!;
  }

  get size(): number {
    return this.nextIndex;
  }

  root(): bigint {
    return this.currentRoot;
  }

  insert(leaf: bigint): bigint {
    assertField("leaf", leaf);
    if (this.nextIndex >= 2 ** this.depth) throw new Error("Merkle tree is full");
    let index = this.nextIndex;
    let current = leaf;
    for (let level = 0; level < this.depth; level += 1) {
      if (index % 2 === 0) {
        this.filled[level] = current;
        current = poseidon([current, this.zeros[level]!]);
      } else {
        current = poseidon([this.filled[level]!, current]);
      }
      index = Math.floor(index / 2);
    }
    this.nextIndex += 1;
    this.currentRoot = current;
    return current;
  }
}

export class MerkleTree {
  private readonly layers: bigint[][];
  private leafCount = 0;

  private constructor(
    readonly depth: number,
    private readonly zeros: bigint[],
  ) {
    this.layers = Array.from({ length: depth + 1 }, () => []);
  }

  static empty(depth: number = TREE_DEPTH): MerkleTree {
    if (!Number.isInteger(depth) || depth < 1 || depth > 32) {
      throw new Error("Merkle depth must be an integer from 1 to 32");
    }
    return new MerkleTree(depth, zeroHashes(depth));
  }

  get size(): number {
    return this.leafCount;
  }

  root(): bigint {
    if (this.leafCount === 0) return this.zeros[this.depth]!;
    return this.layers[this.depth]![0]!;
  }

  insert(leaf: bigint): number {
    assertField("leaf", leaf);
    if (this.leafCount >= 2 ** this.depth) throw new Error("Merkle tree is full");
    const index = this.leafCount;
    this.leafCount += 1;
    this.layers[0]![index] = leaf;
    let current = leaf;
    let cursor = index;
    for (let level = 0; level < this.depth; level += 1) {
      const isRight = cursor % 2 === 1;
      const siblingIndex = isRight ? cursor - 1 : cursor + 1;
      const sibling = this.layers[level]![siblingIndex] ?? this.zeros[level]!;
      const left = isRight ? sibling : current;
      const right = isRight ? current : sibling;
      current = poseidon([left, right]);
      cursor = Math.floor(cursor / 2);
      this.layers[level + 1]![cursor] = current;
    }
    return index;
  }

  getProof(index: number): MerkleProof {
    if (!Number.isInteger(index) || index < 0 || index >= this.leafCount) {
      throw new Error("Merkle leaf index is out of range");
    }
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let cursor = index;
    for (let level = 0; level < this.depth; level += 1) {
      const isRight = cursor % 2 === 1;
      const siblingIndex = isRight ? cursor - 1 : cursor + 1;
      pathElements.push(this.layers[level]![siblingIndex] ?? this.zeros[level]!);
      pathIndices.push(isRight ? 1 : 0);
      cursor = Math.floor(cursor / 2);
    }
    return { pathElements, pathIndices, root: this.root() };
  }

  verify(leaf: bigint, proof: MerkleProof, root: bigint = proof.root): boolean {
    if (proof.pathElements.length !== this.depth || proof.pathIndices.length !== this.depth) {
      return false;
    }
    let current = leaf;
    for (let level = 0; level < this.depth; level += 1) {
      const sibling = proof.pathElements[level]!;
      const isRight = proof.pathIndices[level] === 1;
      if (proof.pathIndices[level] !== 0 && proof.pathIndices[level] !== 1) return false;
      current = isRight ? poseidon([sibling, current]) : poseidon([current, sibling]);
    }
    return current === root;
  }
}
