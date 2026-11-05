import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TREE_DEPTH } from "../src/core/constants.js";
import { randomField } from "../src/core/crypto/field.js";
import { IncrementalMerkleTree, MerkleTree } from "../src/core/merkle/MerkleTree.js";

describe("Poseidon Merkle tree", () => {
  it("uses the circuit depth and verifies real paths", () => {
    const tree = MerkleTree.empty();
    expect(tree.depth).toBe(TREE_DEPTH);
    const leaves = [randomField(), randomField(), randomField()];
    const indexes = leaves.map((leaf) => tree.insert(leaf));
    for (const index of indexes) {
      const proof = tree.getProof(index);
      expect(proof.pathElements).toHaveLength(TREE_DEPTH);
      expect(proof.pathIndices).toHaveLength(TREE_DEPTH);
      expect(tree.verify(leaves[index]!, proof, tree.root())).toBe(true);
    }
  });

  it("rejects a forged sibling and a proof for the wrong leaf", () => {
    const tree = MerkleTree.empty();
    const leaf = randomField();
    const index = tree.insert(leaf);
    tree.insert(randomField());
    const proof = tree.getProof(index);
    const forged = {
      ...proof,
      pathElements: [...proof.pathElements],
    };
    forged.pathElements[0] = forged.pathElements[0]! + 1n;
    expect(tree.verify(leaf, forged, tree.root())).toBe(false);
    expect(tree.verify(leaf + 1n, proof, tree.root())).toBe(false);
    expect(tree.verify(leaf, { ...proof, pathIndices: [2, ...proof.pathIndices.slice(1)] }, tree.root())).toBe(false);
  });

  it("matches the on-chain frontier tree", () => {
    const full = MerkleTree.empty();
    const incremental = new IncrementalMerkleTree(TREE_DEPTH);
    const leaves = [1n, 2n, 3n, 9n, 11n, 42n];
    for (const leaf of leaves) {
      full.insert(leaf);
      incremental.insert(leaf);
      expect(incremental.root()).toBe(full.root());
    }
    const proof = full.getProof(4);
    expect(full.verify(11n, proof, incremental.root())).toBe(true);
  });

  it("does not use an XOR fold and the empty root is the zero hash", () => {
    const empty = MerkleTree.empty().root();
    const tree = MerkleTree.empty();
    const left = 11n;
    const right = 13n;
    tree.insert(left);
    tree.insert(right);
    expect(tree.root()).not.toBe(left ^ right);
    expect(empty).not.toBe(0n);
    const circuit = readFileSync("circuits/shielded_transfer.circom", "utf8");
    expect(circuit).toContain(`ShieldedTransfer(${TREE_DEPTH}, 64)`);
    expect(circuit).not.toContain("valid <== 1");
  });
});
