import { describe, expect, it } from "vitest";
import { equalBytes, fromHex, toHex } from "../src/bytes";
import { merkleRoot, verifyMerkleProof } from "../src/merkle";
import { buildPayRun, parseRunMemo, PayRunError, runMemo, slipRootOf, statementOf } from "../src/run";
import { ADDR, sampleSlip } from "./fixtures";

const seed = (b: number) => fromHex(b.toString(16).padStart(2, "0").repeat(32));

function team() {
  const ada = sampleSlip();
  const bayo = sampleSlip({
    employee: { ...ada.employee, address: ADDR.bayo, name: "Bayo Adeyemi", staffId: "ACM-0043" },
    payout: { address: ADDR.bayo, denom: "uqor", amount: 250_000_000n },
  });
  const chidi = sampleSlip({
    employee: { ...ada.employee, address: ADDR.chidi, name: "Chidi Eze", staffId: "ACM-0044" },
    payout: { address: ADDR.chidi, denom: "uqor", amount: 300_000_000n },
  });
  return [
    { slip: ada, seed: seed(1) },
    { slip: bayo, seed: seed(2) },
    { slip: chidi, seed: seed(3) },
  ];
}

describe("buildPayRun", () => {
  it("builds a run whose every slip proves into the run root", () => {
    const run = buildPayRun("qorechain-diana", team());
    expect(run.slips).toHaveLength(3);
    expect(run.totalPayout).toBe(382_100_000n + 250_000_000n + 300_000_000n);
    for (const s of run.slips) {
      expect(s.slipRoot).toEqual(slipRootOf(merkleRoot(s.commitments)));
      expect(verifyMerkleProof(s.slipRoot, s.runProof, run.runRoot)).toBe(true);
    }
  });

  it("is deterministic for fixed seeds", () => {
    expect(toHex(buildPayRun("qorechain-diana", team()).runRoot)).toBe(toHex(buildPayRun("qorechain-diana", team()).runRoot));
  });

  it("changes the run root when one kobo changes on one payslip", () => {
    const changed = team();
    changed[1]!.slip.deductions[0]!.amount += 1n;
    expect(equalBytes(buildPayRun("qorechain-diana", team()).runRoot, buildPayRun("qorechain-diana", changed).runRoot)).toBe(false);
  });

  const refuse = (what: string, edit: (t: ReturnType<typeof team>) => void) =>
    it(`refuses ${what}`, () => {
      const t = team();
      edit(t);
      expect(() => buildPayRun("qorechain-diana", t)).toThrow(PayRunError);
    });

  refuse("an empty run", (t) => t.splice(0));
  refuse("two employers", (t) => (t[1]!.slip.employer = { address: ADDR.chidi, name: "Other Ltd" }));
  refuse("two periods", (t) => (t[1]!.slip.period = "2026-10"));
  refuse("two denoms", (t) => (t[1]!.slip.payout = { ...t[1]!.slip.payout, denom: "uother" }));
  refuse("two payslips for one employee", (t) => (t[1]!.slip.employee = { ...t[0]!.slip.employee }));
  refuse("two payslips paying one address", (t) => (t[1]!.slip.payout = { ...t[1]!.slip.payout, address: ADDR.adaPayout }));
  refuse("paying the employer", (t) => (t[1]!.slip.payout = { ...t[1]!.slip.payout, address: ADDR.employer }));

  it("refuses a bad chain ID", () => {
    expect(() => buildPayRun("Qore Chain!", team())).toThrow(PayRunError);
  });
});

describe("memo and statement", () => {
  it("round-trips the memo", () => {
    const run = buildPayRun("qorechain-diana", team());
    const memo = runMemo(run.runRoot);
    expect(memo).toMatch(/^cista:v1:[0-9a-f]{64}$/);
    expect(parseRunMemo(memo)).toEqual(run.runRoot);
    expect(parseRunMemo("hello")).toBeNull();
    expect(parseRunMemo("cista:v1:" + "G".repeat(64))).toBeNull();
  });

  it("states what the employer is signing in readable lines", () => {
    const run = buildPayRun("qorechain-diana", team());
    const text = statementOf(run);
    expect(text.split("\n")).toEqual([
      "Cista pay run v1",
      "Chain: qorechain-diana",
      `Employer: ${ADDR.employer}`,
      "Period: 2026-11",
      "Payslips: 3",
      "Total payout: 932100000uqor",
      `Run root: ${toHex(run.runRoot)}`,
    ]);
  });
});
