import type { SignedRun } from "@phoenix-2203/cista";
import { describe, expect, it } from "vitest";
import { Store } from "../src/db";

const run = (root: string, period = "2026-11"): SignedRun => ({
  chainId: "qorechain-diana",
  employer: "qor1employer",
  period,
  denom: "uqor",
  totalPayout: "10",
  count: 2,
  runRoot: root,
  signature: { signatureType: "ml-dsa-87-hybrid", classical: { keyType: "secp256k1", publicKey: "", signature: "" }, pq: { algorithmId: 1, signature: "" } },
});

const env = (b: number) => new Uint8Array([b, b, b]);

describe("Store", () => {
  it("stores a run with its envelopes and serves each employee only theirs", () => {
    const s = new Store();
    s.addRun(run("aa"), [{ employee: "qor1ada", envelope: env(1) }, { employee: "qor1bayo", envelope: env(2) }]);
    expect(s.hasRun("aa")).toBe(true);
    expect(s.inboxOf("qor1ada").map((i) => [i.run.runRoot, [...i.envelope]])).toEqual([["aa", [1, 1, 1]]]);
    expect(s.inboxOf("qor1stranger")).toEqual([]);
    expect(s.envelopesOf("aa")).toHaveLength(2);
  });

  it("stores nothing when one envelope is a duplicate", () => {
    const s = new Store();
    expect(() => s.addRun(run("bb"), [{ employee: "qor1ada", envelope: env(1) }, { employee: "qor1ada", envelope: env(2) }])).toThrow();
    expect(s.hasRun("bb")).toBe(false);
    expect(s.inboxOf("qor1ada")).toEqual([]);
  });

  it("refuses the same run twice", () => {
    const s = new Store();
    s.addRun(run("cc"), []);
    expect(() => s.addRun(run("cc"), [])).toThrow();
  });

  it("records a payment once and refuses to reuse a transaction for another run", () => {
    const s = new Store();
    s.addRun(run("dd"), []);
    s.addRun(run("ee"), []);
    s.setPayment("dd", "TX1", 100);
    s.setPayment("dd", "TX2", 200);
    expect(s.getRun("dd")?.payment).toMatchObject({ txHash: "TX1", height: 100 });
    expect(() => s.setPayment("ee", "TX1", 100)).toThrow();
  });

  it("lists an employer's runs, newest period first", () => {
    const s = new Store();
    s.addRun(run("r1", "2026-10"), []);
    s.addRun(run("r2", "2026-11"), []);
    expect(s.runsOf("qor1employer").map((r) => r.run.runRoot)).toEqual(["r2", "r1"]);
  });

  it("uses each nonce once and only before it expires", () => {
    const s = new Store();
    s.addNonce("n1", 1_000);
    expect(s.takeNonce("n1", 500)).toBe(true);
    expect(s.takeNonce("n1", 500)).toBe(false);
    s.addNonce("n2", 1_000);
    expect(s.takeNonce("n2", 2_000)).toBe(false);
  });

  it("expires sessions", () => {
    const s = new Store();
    s.addSession("h", "qor1ada", 1_000);
    expect(s.sessionAddress("h", 500)).toBe("qor1ada");
    expect(s.sessionAddress("h", 1_500)).toBeUndefined();
    s.dropSession("h");
    expect(s.sessionAddress("h", 500)).toBeUndefined();
  });

  it("replaces a recipient card", () => {
    const s = new Store();
    s.putCard("qor1ada", { v: 1 });
    s.putCard("qor1ada", { v: 2 });
    expect(s.getCard("qor1ada")).toEqual({ v: 2 });
  });
});
