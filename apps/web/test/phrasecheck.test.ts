import { describe, expect, it } from "vitest";
import { pickPositions, sameWord } from "../src/lib/phrasecheck";

describe("phrase check", () => {
  it("picks three different positions in order", () => {
    for (let i = 0; i < 50; i++) {
      const p = pickPositions(24);
      expect(p).toHaveLength(3);
      expect(new Set(p).size).toBe(3);
      expect([...p].sort((a, b) => a - b)).toEqual(p);
      expect(p.every((x) => x >= 0 && x < 24)).toBe(true);
    }
  });

  it("keeps going past repeats from the random source", () => {
    const seq = [5, 5, 5, 2, 2, 9];
    expect(pickPositions(24, 3, () => seq.shift()!)).toEqual([2, 5, 9]);
  });

  it("ignores case and spaces, nothing else", () => {
    expect(sameWord("  Orbit ", "orbit")).toBe(true);
    expect(sameWord("orbits", "orbit")).toBe(false);
  });
});
