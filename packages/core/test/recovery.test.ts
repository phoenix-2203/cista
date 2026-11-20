import { describe, expect, it } from "vitest";
import { equalBytes } from "../src/bytes";
import { isRecoveryPhrase, keysFromPhrase, newRecoveryPhrase, seedFromPhrase } from "../src/recovery";

describe("recovery phrase", () => {
  it("is 24 valid words, different every time", () => {
    const a = newRecoveryPhrase();
    expect(a.split(" ")).toHaveLength(24);
    expect(isRecoveryPhrase(a)).toBe(true);
    expect(newRecoveryPhrase()).not.toBe(a);
  });

  it("rebuilds the same sealing key, however it is typed back", () => {
    const p = newRecoveryPhrase();
    const typed = `  ${p.toUpperCase().split(" ").join("   ")}\n`;
    expect(equalBytes(seedFromPhrase(typed), seedFromPhrase(p))).toBe(true);
    expect(equalBytes(keysFromPhrase(typed).mlkemPublicKey, keysFromPhrase(p).mlkemPublicKey)).toBe(true);
  });

  it("gives different keys for different phrases", () => {
    expect(equalBytes(seedFromPhrase(newRecoveryPhrase()), seedFromPhrase(newRecoveryPhrase()))).toBe(false);
  });

  it("refuses a wrong word, a missing word, or two words swapped", () => {
    const words = newRecoveryPhrase().split(" ");
    expect(() => seedFromPhrase(words.slice(0, 23).join(" "))).toThrow();
    expect(() => seedFromPhrase([...words.slice(0, 23), "notaword"].join(" "))).toThrow();
    const swapped = [...words];
    [swapped[0], swapped[23]] = [swapped[23]!, swapped[0]!];
    // A swap usually breaks the checksum; when it doesn't, it still gives another key.
    if (isRecoveryPhrase(swapped.join(" "))) {
      expect(equalBytes(seedFromPhrase(swapped.join(" ")), seedFromPhrase(words.join(" ")))).toBe(false);
    } else {
      expect(() => seedFromPhrase(swapped.join(" "))).toThrow();
    }
  });
});
