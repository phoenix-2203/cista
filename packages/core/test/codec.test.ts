import { describe, expect, it } from "vitest";
import { CodecError, payslipFromJson, payslipToJson } from "../src/codec";
import { sampleSlip } from "./fixtures";

const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("payslip JSON", () => {
  it("round-trips through JSON text without losing a kobo", () => {
    const slip = sampleSlip({ payout: { ...sampleSlip().payout, amount: 123_456_789_012_345_678_901n } });
    expect(payslipFromJson(roundTrip(payslipToJson(slip)))).toEqual(slip);
  });

  const refuse = (what: string, edit: (j: any) => void) =>
    it(`refuses ${what}`, () => {
      const j = roundTrip(payslipToJson(sampleSlip()));
      edit(j);
      expect(() => payslipFromJson(j)).toThrow(CodecError);
    });

  refuse("an amount as a JSON number", (j) => (j.earnings[0].amount = 30000000));
  refuse("an amount with a decimal point", (j) => (j.earnings[0].amount = "300.50"));
  refuse("a negative amount", (j) => (j.deductions[0].amount = "-1"));
  refuse("a leading zero", (j) => (j.payout.amount = "0100"));
  refuse("an unknown key", (j) => (j.bankAccount = "0123456789"));
  refuse("a missing key", (j) => delete j.thresholds);
  refuse("an unknown version", (j) => (j.version = 2));
  refuse("an invalid payslip (bad date)", (j) => (j.payDate = "2026-02-31"));
  refuse("a non-object", (j) => (j.employee = "Ada"));

  it("refuses null and arrays", () => {
    expect(() => payslipFromJson(null)).toThrow(CodecError);
    expect(() => payslipFromJson([])).toThrow(CodecError);
  });
});
