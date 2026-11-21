import { validatePayslip } from "@phoenix-2203/cista";
import { describe, expect, it } from "vitest";
import { centsToFusd, FUSD, lines, PAY_BANDS, rowToPayslip, teamFromCsv, teamToCsv, toCents, YTD_BANDS, type TeamRow } from "../src/lib/payroll";

const row: TeamRow = {
  address: "qor1k3lpzfetuf09e7d85rsc8mrsxeg53mzuz7nqj3",
  name: "Ada Obi",
  staffId: "ACM-0042",
  role: "Operations Analyst",
  employedSince: "2025-03-01",
  basic: "3,000",
  allowances: "450.50",
  bonus: "",
  tax: "420",
  pension: "240",
  otherDeductions: "",
  employerPension: "",
};
const settings = { employer: "qor1lhn3955g79jfmuzvqmcz3msyr57qx78eyvlanh", employerName: "Acme Logistics Ltd", period: "2026-11", payDate: "2026-11-28", payFrequency: "monthly" as const };

describe("payroll", () => {
  it("reads dollar amounts into cents", () => {
    expect(toCents("3,000")).toBe(300_000n);
    expect(toCents("$1,234.5")).toBe(123_450n);
    expect(toCents("")).toBe(0n);
    expect(() => toCents("12.345")).toThrow();
    expect(() => toCents("-5")).toThrow();
  });

  it("works out gross and net", () => {
    const l = lines(row);
    expect(l.gross).toBe(345_050n);
    expect(l.net).toBe(345_050n - 42_000n - 24_000n);
  });

  it("pays $1 as 1 fUSD (6 decimals)", () => {
    expect(centsToFusd(100n)).toBe(1_000_000n);
    expect(centsToFusd(279_050n)).toBe(2_790_500_000n);
  });

  it("makes a valid USD payslip paid in fUSD, with the pay bands", () => {
    const slip = rowToPayslip(row, settings);
    expect(() => validatePayslip(slip)).not.toThrow();
    expect(slip.currency).toBe("USD");
    expect(slip.payout).toEqual({ address: row.address, denom: FUSD.denom, amount: 2_790_500_000n });
    expect(slip.thresholds).toHaveLength(PAY_BANDS.length);
    expect(slip.earnings.map((e) => e.code)).toEqual(["basic", "allowances"]);
  });

  it("carries pay frequency, the employer's pension and the year so far", () => {
    const first = rowToPayslip({ ...row, employerPension: "300" }, settings);
    expect(first.payFrequency).toBe("monthly");
    expect(first.employerContributions).toEqual([{ code: "pension", label: "Employer pension contribution", amount: 30_000n }]);
    expect(first.yearToDate?.gross).toBe(345_050n);
    expect(first.yearToDate?.deductions).toBe(66_000n);
    expect(first.yearToDate?.thresholds).toHaveLength(YTD_BANDS.length);
    const later = rowToPayslip(row, settings, { gross: 1_000_000n, deductions: 200_000n });
    expect(later.yearToDate?.gross).toBe(1_345_050n);
    expect(later.yearToDate?.deductions).toBe(266_000n);
    expect(() => validatePayslip(later)).not.toThrow();
  });

  it("refuses a row with no basic salary, or deductions above pay", () => {
    expect(() => rowToPayslip({ ...row, basic: "" }, settings)).toThrow(/basic/);
    expect(() => rowToPayslip({ ...row, tax: "9000" }, settings)).toThrow(/deductions/);
  });

  it("round-trips the team through CSV, quotes and all", () => {
    const team = [row, { ...row, name: 'Bayo "BJ" Adeyemi, Jr', address: "qor1g65nhydslp29cl7tqzh6vr5ghft34x4msfxnvc" }];
    expect(teamFromCsv(teamToCsv(team))).toEqual(team);
  });

  it("reads a CSV with columns in another order and Windows line ends", () => {
    const rows = teamFromCsv("name,address\r\nAda,qor1abc\r\n");
    expect(rows[0]).toMatchObject({ name: "Ada", address: "qor1abc" });
    expect(() => teamFromCsv("name\nAda")).toThrow(/address/);
  });
});
