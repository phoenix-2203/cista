import { describe, expect, it } from "vitest";
import { bands, claims, fieldName, fieldValue, perPeriod, presetFields, ytdBands } from "../src/lib/fields";

const values: Record<string, string> = {
  "employer.name": "Acme",
  "employee.role": "Analyst",
  "employee.employedSince": "2025-03-01",
  period: "2026-11",
  currency: "USD",
  net: "279050",
  gross: "345050",
  "payout.address": "qor1ada",
  "payout.amount": "2790500000",
  "payout.denom": "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA",
  "net.atLeast.250000": "yes",
  "net.atLeast.100000": "yes",
  "net.atLeast.300000": "no",
  "net.atLeast.500000": "no",
};

describe("proof fields", () => {
  it("orders the pay bands and knows which hold", () => {
    expect(bands(values).map((b) => [Number(b.amount), b.yes])).toEqual([[100000, true], [250000, true], [300000, false], [500000, false]]);
  });

  it("builds the standard proof types from the right fields", () => {
    expect(presetFields("employment", values)).toEqual(["employer.name", "period", "employee.role", "employee.employedSince"]);
    expect(presetFields("above", values, { above: "net.atLeast.250000" })).toEqual(["employer.name", "period", "net.atLeast.250000"]);
    expect(presetFields("range", values, { from: "net.atLeast.250000", to: "net.atLeast.300000" })).toEqual(["employer.name", "period", "net.atLeast.250000", "net.atLeast.300000"]);
    expect(presetFields("exact", values)).toContain("payout.amount");
    expect(presetFields("employment", values)).not.toContain("net");
  });

  it("turns two bands into one range sentence", () => {
    expect(claims({ currency: "USD", period: "2026-11", "net.atLeast.250000": "yes", "net.atLeast.300000": "no" })).toEqual([
      "Net pay for 2026-11 was at least $2,500.00 and less than $3,000.00.",
    ]);
  });

  it("uses the highest 'yes' and the lowest 'no', whatever else is shown", () => {
    const c = claims({ currency: "USD", "net.atLeast.100000": "yes", "net.atLeast.250000": "yes", "net.atLeast.500000": "no", "net.atLeast.300000": "no" });
    expect(c).toEqual(["Net pay was at least $2,500.00 and less than $3,000.00."]);
  });

  it("states employment, exact pay and the on-chain payout", () => {
    const c = claims(values);
    expect(c[0]).toBe("Employed by Acme as Analyst since 2025-03-01, and on the payroll for 2026-11.");
    expect(c).toContain("Net pay for 2026-11 was $2,790.50 (gross $3,450.50).");
    expect(c.at(-1)).toBe("2,790.5 fUSD was paid to qor1ada, checked on chain.");
  });

  it("names and formats fields", () => {
    expect(fieldName("net.atLeast.250000")).toBe("Net pay is at least $2,500.00");
    expect(fieldName("deduction.tax")).toBe("Deduction: income tax");
    expect(fieldValue("payout.amount", "2790500000", values)).toBe("2,790.5 fUSD");
    expect(fieldValue("net", "279050", values)).toBe("$2,790.50");
  });
});

describe("pay frequency and the year so far", () => {
  const year: Record<string, string> = {
    "employer.name": "Acme",
    period: "2026-11",
    currency: "USD",
    payFrequency: "biweekly",
    "ytd.gross": "3500000",
    "ytd.net": "2800000",
    "ytd.net.atLeast.2500000": "yes",
    "ytd.net.atLeast.3000000": "no",
  };

  it("names and formats the new fields", () => {
    expect(fieldName("ytd.net")).toBe("Net pay this year");
    expect(fieldName("ytd.net.atLeast.2500000")).toBe("Net pay this year is at least $25,000.00");
    expect(fieldValue("ytd.net", "2800000")).toBe("$28,000.00");
    expect(fieldValue("payFrequency", "biweekly")).toBe("every two weeks");
    expect(perPeriod({ payFrequency: "weekly" })).toBe("a week");
    expect(perPeriod({})).toBe("a month");
  });

  it("proves earnings this year with one band, and reads it as a sentence", () => {
    expect(presetFields("ytd", year, { ytd: "ytd.net.atLeast.2500000" })).toEqual(["employer.name", "period", "ytd.net.atLeast.2500000"]);
    expect(claims({ currency: "USD", period: "2026-11", "ytd.net.atLeast.2500000": "yes" })).toContain("Net pay in 2026, up to 2026-11, was at least $25,000.00.");
    expect(claims({ currency: "USD", "employer.name": "Acme", payFrequency: "biweekly" })[0]).toBe("Employed by Acme, paid every two weeks.");
  });

  it("keeps monthly bands apart from the year's bands", () => {
    expect(bands(year)).toEqual([]);
    expect(ytdBands(year).map((b) => b.yes)).toEqual([true, false]);
  });
});
