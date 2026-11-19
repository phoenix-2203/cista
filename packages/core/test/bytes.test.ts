import { describe, expect, it } from "vitest";
import { concat, equalBytes, fromHex, fromUtf8, lengthPrefixed, toHex, utf8 } from "../src/bytes";

describe("bytes", () => {
  it("round-trips hex", () => {
    const b = new Uint8Array([0, 1, 254, 255]);
    expect(toHex(b)).toBe("0001feff");
    expect(fromHex("0x0001feff")).toEqual(b);
  });

  it("refuses bad hex", () => {
    expect(() => fromHex("abc")).toThrow();
    expect(() => fromHex("zz")).toThrow();
  });

  it("round-trips utf-8, including naira signs", () => {
    expect(fromUtf8(utf8("₦250,000"))).toBe("₦250,000");
  });

  it("length-prefixes so that ab|c and a|bc differ", () => {
    const x = concat(lengthPrefixed(utf8("ab")), lengthPrefixed(utf8("c")));
    const y = concat(lengthPrefixed(utf8("a")), lengthPrefixed(utf8("bc")));
    expect(equalBytes(x, y)).toBe(false);
    expect(toHex(lengthPrefixed(utf8("ab")))).toBe("000000026162");
  });

  it("compares bytes", () => {
    expect(equalBytes(utf8("a"), utf8("a"))).toBe(true);
    expect(equalBytes(utf8("a"), utf8("b"))).toBe(false);
    expect(equalBytes(utf8("a"), utf8("aa"))).toBe(false);
  });
});
