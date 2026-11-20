import { validatePayslip } from "@phoenix-2203/cista";
import { describe, expect, it } from "vitest";
import { lines, payoutUqor, percentOf, rowToPayslip, teamFromCsv, teamToCsv, toKobo, type TeamRow } from "../src/lib/payroll";

const row: TeamRow = {
  address: "qor1k3lpzfetuf09e7d85rsc8mrsxeg53mzuz7nqj3",
  name: "Ada Obi",
  staffId: "ACM-0042",
  role: "Operations Analyst",
  employedSince: "2025-03-01",
  basic: "300,000",
  housing: "120000",
  transport: "60000",
  paye: "52000",
};
const settings = {
  employer: "qor1lhn3955g79jfmuzvqmcz3msyr57qx78eyvlanh",
  employerName: "Acme Logistics Ltd",
  period: "2026-11",
  payDate: "2026-11-28",
  nairaPerQor: "1000",
  thresholds: ["100000", "250000", "500000", ""],
};

describe("payroll", () => {
  it("reads naira amounts into kobo", () => {
    expect(toKobo("300,000")).toBe(30_000_000n);
    expect(toKobo("₦1,234.5")).toBe(123_450n);
    expect(toKobo("")).toBe(0n);
    expect(() => toKobo("12.345")).toThrow();
    expect(() => toKobo("-5")).toThrow();
  });

  it("rounds percentages to the nearest kobo", () => {
    expect(percentOf(101n, 250n)).toBe(3n); // 2.525 kobo -> 3
    expect(percentOf(100n, 250n)).toBe(3n); // 2.5 -> 3 (half up)
    expect(percentOf(99n, 250n)).toBe(2n);
  });

  it("works out pension (8% / 10% of basic + housing + transport) and NHF (2.5% of basic)", () => {
    const l = lines(row);
    expect(l.gross).toBe(48_000_000n);
    expect(l.pension).toBe(3_840_000n);
    expect(l.employerPension).toBe(4_800_000n);
    expect(l.nhf).toBe(750_000n);
    expect(l.net).toBe(48_000_000n - 3_840_000n - 750_000n - 5_200_000n);
  });

  it("converts net pay to uqor at the employer's rate", () => {
    expect(payoutUqor(38_210_000n, "1000")).toBe(382_100_000n);
    expect(() => payoutUqor(1n, "0")).toThrow();
  });

  it("makes a valid payslip", () => {
    const slip = rowToPayslip(row, settings);
    expect(() => validatePayslip(slip)).not.toThrow();
    expect(slip.payout.amount).toBe(382_100_000n);
    expect(slip.thresholds).toEqual([10_000_000n, 25_000_000n, 50_000_000n]);
  });

  it("refuses a row whose deductions exceed pay", () => {
    expect(() => rowToPayslip({ ...row, paye: "900000" }, settings)).toThrow(/deductions/);
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
