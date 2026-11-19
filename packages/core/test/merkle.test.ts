import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { toHex, utf8 } from "../src/bytes";
import { EMPTY_LEAF, hashLeaf, hashNode, merkleProof, merkleRoot, verifyMerkleProof } from "../src/merkle";

const v = (n: number) => sha256(utf8(`value-${n}`));
const values = (count: number) => Array.from({ length: count }, (_, i) => v(i));

describe("merkle tree", () => {
  it("of one value is the hashed leaf", () => {
    expect(merkleRoot([v(0)])).toEqual(hashLeaf(v(0)));
  });

  it("pads odd sizes with the fixed empty leaf, not a copy of the last one", () => {
    const three = merkleRoot(values(3));
    const expected = hashNode(hashNode(hashLeaf(v(0)), hashLeaf(v(1))), hashNode(hashLeaf(v(2)), hashLeaf(EMPTY_LEAF)));
    expect(three).toEqual(expected);
    expect(toHex(three)).not.toBe(toHex(merkleRoot([v(0), v(1), v(2), v(2)])));
  });

  it("proves every leaf for sizes 1 to 33", () => {
    for (let n = 1; n <= 33; n++) {
      const list = values(n);
      const root = merkleRoot(list);
      for (let i = 0; i < n; i++) expect(verifyMerkleProof(list[i]!, merkleProof(list, i), root)).toBe(true);
    }
  });

  it("refuses a proof for the wrong value, index or root", () => {
    const list = values(5);
    const root = merkleRoot(list);
    const proof = merkleProof(list, 2);
    expect(verifyMerkleProof(v(99), proof, root)).toBe(false);
    expect(verifyMerkleProof(list[2]!, { ...proof, index: 3 }, root)).toBe(false);
    expect(verifyMerkleProof(list[2]!, proof, merkleRoot(values(6)))).toBe(false);
  });

  it("refuses an inner node passed off as a leaf", () => {
    const list = values(4);
    const root = merkleRoot(list);
    const inner = hashNode(hashLeaf(list[0]!), hashLeaf(list[1]!));
    const proof = merkleProof(list, 0);
    expect(verifyMerkleProof(inner, { index: 0, siblings: proof.siblings.slice(1) }, root)).toBe(false);
  });

  it("refuses malformed proofs without throwing", () => {
    const list = values(4);
    const root = merkleRoot(list);
    const proof = merkleProof(list, 1);
    expect(verifyMerkleProof(list[1]!, { index: 9, siblings: proof.siblings }, root)).toBe(false);
    expect(verifyMerkleProof(list[1]!, { index: 1, siblings: [new Uint8Array(3), proof.siblings[1]!] }, root)).toBe(false);
  });

  it("refuses empty trees and bad indexes", () => {
    expect(() => merkleRoot([])).toThrow();
    expect(() => merkleProof(values(2), 2)).toThrow();
  });

  it("matches a pinned root (test vector)", () => {
    expect(toHex(merkleRoot(values(3)))).toMatchInlineSnapshot(`"259085539ff4d0258e34075aad135c509d60a37c40c1ae22c30a3e951d1394ca"`);
  });
});
