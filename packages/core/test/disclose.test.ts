import { describe, expect, it } from "vitest";
import { fromHex, toHex } from "../src/bytes";
import { fieldSalt } from "../src/commit";
import { checkDisclosure, createDisclosure, disclosureDigest, DisclosureError, proofStatement, type Disclosure } from "../src/disclose";
import { buildPayRun } from "../src/run";
import { ADDR, sampleSlip } from "./fixtures";

function run() {
  const ada = sampleSlip();
  const bayo = sampleSlip({
    employee: { ...ada.employee, address: ADDR.bayo, name: "Bayo Adeyemi", staffId: "ACM-0043" },
    payout: { address: ADDR.bayo, denom: "uqor", amount: 250_000_000n },
  });
  return buildPayRun("qorechain-diana", [
    { slip: ada, seed: fromHex("01".repeat(32)) },
    { slip: bayo, seed: fromHex("02".repeat(32)) },
  ]);
}

const clone = (d: Disclosure): Disclosure => JSON.parse(JSON.stringify(d));

describe("createDisclosure + checkDisclosure", () => {
  it("reveals only the chosen fields, plus whose payslip it is and its currency", () => {
    const r = run();
    const d = createDisclosure(r, r.slips[0]!, ["employer.name", "net.atLeast.25000000"]);
    const checked = checkDisclosure(d);
    expect(checked.employee).toBe(ADDR.ada);
    expect(checked.fields).toEqual({
      "employer.name": "Acme Logistics Ltd",
      "employee.address": ADDR.ada,
      currency: "NGN",
      "net.atLeast.25000000": "yes",
    });
    expect(checked.runRoot).toEqual(r.runRoot);
    const json = JSON.stringify(d);
    expect(json).not.toContain("38210000");
    expect(json).not.toContain("Ada Obi");
  });

  it("works for the second payslip too", () => {
    const r = run();
    const checked = checkDisclosure(createDisclosure(r, r.slips[1]!, ["net"]));
    expect(checked.employee).toBe(ADDR.bayo);
  });

  it("refuses an unknown field name", () => {
    const r = run();
    expect(() => createDisclosure(r, r.slips[0]!, ["bank.account"])).toThrow(DisclosureError);
  });

  const tamper = (what: string, edit: (d: Disclosure) => void) =>
    it(`catches ${what}`, () => {
      const r = run();
      const d = clone(createDisclosure(r, r.slips[0]!, ["net", "employee.name"]));
      edit(d);
      expect(() => checkDisclosure(d)).toThrow(DisclosureError);
    });

  tamper("net pay raised by one kobo", (d) => (d.fields.find((f) => f.name === "net")!.value = "38210001"));
  tamper("a field renamed", (d) => (d.fields.find((f) => f.name === "net")!.name = "gross"));
  tamper("a wrong salt", (d) => (d.fields[0]!.salt = "00".repeat(32)));
  tamper("a field moved to another position", (d) => (d.fields.find((f) => f.name === "net")!.index += 1));
  tamper("another run root", (d) => (d.runRoot = "ab".repeat(32)));
  tamper("a broken payslip proof", (d) => (d.slipSiblings[0] = "cd".repeat(32)));
  tamper("the employee address left out", (d) => (d.fields = d.fields.filter((f) => f.name !== "employee.address")));
  tamper("the currency left out", (d) => (d.fields = d.fields.filter((f) => f.name !== "currency")));
  tamper("a field revealed twice", (d) => d.fields.push({ ...d.fields[0]! }));
  tamper("uppercase hex", (d) => (d.runRoot = d.runRoot.toUpperCase()));
  tamper("a version change", (d) => ((d as { v: number }).v = 2));

  it("catches fields spliced from two different payslips", () => {
    const r = run();
    const mine = createDisclosure(r, r.slips[0]!, []);
    const theirs = createDisclosure(r, r.slips[1]!, ["net"]);
    const spliced = clone(mine);
    spliced.fields.push(theirs.fields.find((f) => f.name === "net")!);
    expect(() => checkDisclosure(spliced)).toThrow(/same payslip/);
  });

  it("catches a claimed employer that differs from the revealed one", () => {
    const r = run();
    const d = clone(createDisclosure(r, r.slips[0]!, ["employer.address"]));
    d.employer = ADDR.chidi;
    expect(() => checkDisclosure(d)).toThrow(/employer/);
  });

  it("does not leak the other fields' salts", () => {
    const r = run();
    const d = createDisclosure(r, r.slips[0]!, ["net"]);
    const grossSalt = toHex(fieldSalt(r.slips[0]!.seed, "gross"));
    expect(JSON.stringify(d)).not.toContain(grossSalt);
    expect(JSON.stringify(d)).not.toContain(toHex(r.slips[0]!.seed));
  });
});

describe("proofStatement", () => {
  it("names the audience, the expiry, the fields and the digest", () => {
    const r = run();
    const d = createDisclosure(r, r.slips[0]!, ["net"]);
    const text = proofStatement(d, { audience: "Zenith Lending, application 4471", expires: "2026-12-31T00:00:00Z" });
    expect(text.split("\n")).toEqual([
      "Cista proof of pay v1",
      "Chain: qorechain-diana",
      "For: Zenith Lending, application 4471",
      "Expires: 2026-12-31T00:00:00.000Z",
      "Shows: employee.address, currency, net",
      `Proof: ${toHex(disclosureDigest(d))}`,
    ]);
  });

  it("changes the digest when anything in the disclosure changes", () => {
    const r = run();
    const d = createDisclosure(r, r.slips[0]!, ["net"]);
    const e = clone(d);
    e.fields[1]!.value = "1";
    expect(toHex(disclosureDigest(d))).not.toBe(toHex(disclosureDigest(e)));
  });

  it("refuses a multi-line audience or a bad expiry", () => {
    const r = run();
    const d = createDisclosure(r, r.slips[0]!, []);
    expect(() => proofStatement(d, { audience: "A\nExpires: never", expires: "2026-12-31" })).toThrow(DisclosureError);
    expect(() => proofStatement(d, { audience: "Bank", expires: "soon" })).toThrow(DisclosureError);
  });
});
