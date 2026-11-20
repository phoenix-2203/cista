import { describe, expect, it } from "vitest";
import { signInStatement } from "../src/signin";

const base = { domain: "cista.duckdns.org", address: "qor1abc", chainId: "qorechain-diana", nonce: "a1b2c3d4e5f6g7h8", issuedAt: "2026-11-20T10:00:00Z" };

describe("signInStatement", () => {
  it("is readable and fixed", () => {
    expect(signInStatement(base).split("\n")).toEqual([
      "Sign in to Cista",
      "Domain: cista.duckdns.org",
      "Account: qor1abc",
      "Chain: qorechain-diana",
      "Nonce: a1b2c3d4e5f6g7h8",
      "Issued: 2026-11-20T10:00:00.000Z",
    ]);
  });

  it("refuses a short nonce, a bad domain or a bad time", () => {
    expect(() => signInStatement({ ...base, nonce: "abc" })).toThrow();
    expect(() => signInStatement({ ...base, domain: "evil.com\nNonce: x" })).toThrow();
    expect(() => signInStatement({ ...base, issuedAt: "today" })).toThrow();
  });
});
