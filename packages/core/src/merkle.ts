/**
 * A small binary Merkle tree over 32-byte values, with SHA-256.
 *
 *   leaf  = SHA-256(0x00 || value)
 *   node  = SHA-256(0x01 || left || right)
 *   empty = SHA-256("cista/empty/v1")      pads the leaves to a power of two
 *
 * The 0x00 / 0x01 prefixes keep a leaf from ever passing for an inner node.
 * Padding with a fixed empty value (instead of copying the last leaf) keeps
 * the tree free of duplicate-leaf tricks and makes verification a plain loop,
 * which is cheap to repeat in Solidity.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, equalBytes, utf8 } from "./bytes";

export const EMPTY_LEAF = sha256(utf8("cista/empty/v1"));
export const MAX_DEPTH = 16;

const LEAF = new Uint8Array([0]);
const NODE = new Uint8Array([1]);

export function hashLeaf(value: Uint8Array): Uint8Array {
  if (value.length !== 32) throw new Error("Merkle leaves are 32-byte values");
  return sha256(concat(LEAF, value));
}

export function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(NODE, left, right));
}

export interface MerkleProof {
  /** Position of the value among the leaves. */
  index: number;
  /** Sibling hashes from the leaf level up. */
  siblings: Uint8Array[];
}

function levels(values: Uint8Array[]): Uint8Array[][] {
  if (values.length === 0) throw new Error("a Merkle tree needs at least one leaf");
  let width = 1;
  while (width < values.length) width *= 2;
  if (width > 2 ** MAX_DEPTH) throw new Error(`at most ${2 ** MAX_DEPTH} leaves`);
  const padded = [...values];
  while (padded.length < width) padded.push(EMPTY_LEAF);
  const out: Uint8Array[][] = [padded.map(hashLeaf)];
  while (out[out.length - 1]!.length > 1) {
    const below = out[out.length - 1]!;
    const above: Uint8Array[] = [];
    for (let i = 0; i < below.length; i += 2) above.push(hashNode(below[i]!, below[i + 1]!));
    out.push(above);
  }
  return out;
}

export function merkleRoot(values: Uint8Array[]): Uint8Array {
  const all = levels(values);
  return all[all.length - 1]![0]!;
}

export function merkleProof(values: Uint8Array[], index: number): MerkleProof {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new Error("leaf index out of range");
  const all = levels(values);
  const siblings: Uint8Array[] = [];
  let i = index;
  for (let level = 0; level < all.length - 1; level++) {
    siblings.push(all[level]![i ^ 1]!);
    i >>= 1;
  }
  return { index, siblings };
}

/** Recomputes the root from a value and its proof. */
export function rootFromProof(value: Uint8Array, proof: MerkleProof): Uint8Array {
  if (proof.siblings.length > MAX_DEPTH) throw new Error("proof is too long");
  if (!Number.isInteger(proof.index) || proof.index < 0 || proof.index >= 2 ** proof.siblings.length) {
    throw new Error("leaf index does not fit the proof");
  }
  let hash = hashLeaf(value);
  let i = proof.index;
  for (const sibling of proof.siblings) {
    if (sibling.length !== 32) throw new Error("proof hashes are 32 bytes");
    hash = i & 1 ? hashNode(sibling, hash) : hashNode(hash, sibling);
    i >>= 1;
  }
  return hash;
}

export function verifyMerkleProof(value: Uint8Array, proof: MerkleProof, root: Uint8Array): boolean {
  try {
    return equalBytes(rootFromProof(value, proof), root);
  } catch {
    return false;
  }
}
