import { describe, expect, it } from "vitest";
import { grossPay, netPay, payslipFields, PayslipError, totalDeductions, validatePayslip, type Payslip } from "../src/payslip";
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

describe("payout denoms", () => {
  it("accepts uqor and an ERC-20 token's native denom (fUSD)", () => {
    for (const denom of ["uqor", "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA"]) {
      expect(() => validatePayslip(sampleSlip({ payout: { ...sampleSlip().payout, denom } }))).not.toThrow();
    }
  });

  it("refuses malformed denoms", () => {
    for (const denom of ["UQOR", "erc20:0x1234", "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CAz", "u qor"]) {
      expect(() => validatePayslip(sampleSlip({ payout: { ...sampleSlip().payout, denom } }))).toThrow(PayslipError);
    }
  });
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

describe("pay frequency and the year so far", () => {
  const withYtd = (over: Partial<Payslip> = {}): Payslip => {
    const base = sampleSlip();
    return {
      ...base,
      payFrequency: "monthly",
      yearToDate: { gross: grossPay(base) * 11n, deductions: totalDeductions(base) * 11n, thresholds: [100_000_000n, 1_000_000_000n] },
      ...over,
    };
  };

  it("leaves older payslips' fields exactly as they were", () => {
    const names = payslipFields(sampleSlip()).map((f) => f.name);
    expect(names.some((n) => n === "payFrequency" || n.startsWith("ytd."))).toBe(false);
  });

  it("commits to the frequency and the year-to-date totals and bands", () => {
    const slip = withYtd();
    const f = Object.fromEntries(payslipFields(slip).map((x) => [x.name, x.value]));
    expect(f.payFrequency).toBe("monthly");
    expect(f["ytd.gross"]).toBe((grossPay(slip) * 11n).toString());
    expect(f["ytd.net"]).toBe(((grossPay(slip) - totalDeductions(slip)) * 11n).toString());
    expect(f["ytd.net.atLeast.100000000"]).toBe(netPay(slip) * 11n >= 100_000_000n ? "yes" : "no");
    expect(f["ytd.net.atLeast.1000000000"]).toBe(netPay(slip) * 11n >= 1_000_000_000n ? "yes" : "no");
  });

  it("refuses a year so far smaller than this payslip, or an unknown frequency", () => {
    const base = sampleSlip();
    expect(() => validatePayslip(withYtd({ yearToDate: { gross: grossPay(base) - 1n, deductions: 0n, thresholds: [] } }))).toThrow(PayslipError);
    expect(() => validatePayslip(withYtd({ yearToDate: { gross: grossPay(base), deductions: totalDeductions(base) + grossPay(base), thresholds: [] } }))).toThrow(PayslipError);
    expect(() => validatePayslip(withYtd({ payFrequency: "daily" as never }))).toThrow(PayslipError);
    expect(() => validatePayslip(withYtd({ yearToDate: { gross: grossPay(base) * 2n, deductions: totalDeductions(base) * 2n, thresholds: [5n, 5n] } }))).toThrow(PayslipError);
  });
});
