import { describe, expect, it } from "vitest";
import { grossPay, netPay, payslipFields, PayslipError, validatePayslip } from "../src/payslip";
import { ADDR, naira, sampleSlip } from "./fixtures";

describe("payslip totals", () => {
  it("adds up gross and net in kobo", () => {
    const slip = sampleSlip();
    expect(grossPay(slip)).toBe(naira(480_000));
    expect(netPay(slip)).toBe(naira(382_100));
  });
});

describe("validatePayslip", () => {
  it("accepts the sample", () => {
    expect(() => validatePayslip(sampleSlip())).not.toThrow();
  });

  const bad: [string, Parameters<typeof sampleSlip>[0]][] = [
    ["a non-qor employee address", { employee: { ...sampleSlip().employee, address: "cosmos1abc" } }],
    ["the employer paying itself", { employee: { ...sampleSlip().employee, address: ADDR.employer } }],
    ["an impossible date", { payDate: "2026-02-30" }],
    ["a bad period", { period: "2026-13" }],
    ["a lowercase currency", { currency: "ngn" }],
    ["no earnings", { earnings: [] }],
    ["a repeated code", { deductions: [{ code: "paye", label: "PAYE", amount: 1n }, { code: "paye", label: "PAYE", amount: 1n }] }],
    ["a negative line", { deductions: [{ code: "paye", label: "PAYE", amount: -1n }] }],
    ["deductions above gross", { deductions: [{ code: "loan", label: "Loan", amount: naira(1_000_000) }] }],
    ["a zero payout", { payout: { address: ADDR.adaPayout, denom: "uqor", amount: 0n } }],
    ["repeated thresholds", { thresholds: [1n, 1n] }],
    ["a name with trailing spaces", { employer: { address: ADDR.employer, name: "Acme " } }],
    ["a start date after the pay date", { employee: { ...sampleSlip().employee, employedSince: "2027-01-01" } }],
  ];
  for (const [what, override] of bad) {
    it(`refuses ${what}`, () => {
      expect(() => validatePayslip(sampleSlip(override))).toThrow(PayslipError);
    });
  }
});

describe("payslipFields", () => {
  it("is deterministic and has unique names", () => {
    const a = payslipFields(sampleSlip());
    const b = payslipFields(sampleSlip());
    expect(a).toEqual(b);
    expect(new Set(a.map((f) => f.name)).size).toBe(a.length);
  });

  it("carries the totals and the payout", () => {
    const f = Object.fromEntries(payslipFields(sampleSlip()).map((x) => [x.name, x.value]));
    expect(f["gross"]).toBe("48000000");
    expect(f["deductions"]).toBe("9790000");
    expect(f["net"]).toBe("38210000");
    expect(f["payout.amount"]).toBe("382100000");
    expect(f["employee.address"]).toBe(ADDR.ada);
  });

  it("answers the net-pay thresholds in ascending order", () => {
    const thresholds = payslipFields(sampleSlip()).filter((x) => x.name.startsWith("net.atLeast."));
    expect(thresholds).toEqual([
      { name: "net.atLeast.10000000", value: "yes" },
      { name: "net.atLeast.25000000", value: "yes" },
      { name: "net.atLeast.50000000", value: "no" },
    ]);
  });

  it("does not commit to line labels, only codes", () => {
    const relabelled = sampleSlip();
    relabelled.earnings[0] = { ...relabelled.earnings[0]!, label: "Base pay" };
    expect(payslipFields(relabelled)).toEqual(payslipFields(sampleSlip()));
  });
});
