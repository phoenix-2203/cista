import { describe, expect, it } from "vitest";
import { nextPayDate, nextPeriod } from "../src/lib/history";
import { centsToDollars, payslipToRow, rowToPayslip, type TeamRow } from "../src/lib/payroll";

const row: TeamRow = {
  address: "qor1k3lpzfetuf09e7d85rsc8mrsxeg53mzuz7nqj3",
  name: "Ada Obi",
  staffId: "ACM-0042",
  role: "Operations Analyst",
  employedSince: "2025-03-01",
  basic: "3000",
  allowances: "450.50",
  bonus: "",
  tax: "420",
  pension: "240",
  otherDeductions: "",
};
const settings = { employer: "qor1lhn3955g79jfmuzvqmcz3msyr57qx78eyvlanh", employerName: "Acme Logistics Ltd", period: "2026-11", payDate: "2026-11-28" };

describe("starting from an earlier run", () => {
  it("turns a payslip back into the row it came from", () => {
    expect(payslipToRow(rowToPayslip(row, settings))).toEqual(row);
  });

  it("writes cents as a person would type dollars", () => {
    expect(centsToDollars(300000n)).toBe("3000");
    expect(centsToDollars(45050n)).toBe("450.50");
    expect(centsToDollars(5n)).toBe("0.05");
    expect(centsToDollars(0n)).toBe("");
  });

  it("moves the period and pay date on by a month", () => {
    expect(nextPeriod("2026-11")).toBe("2026-12");
    expect(nextPeriod("2026-12")).toBe("2027-01");
    expect(nextPayDate("2026-11-28")).toBe("2026-12-28");
    expect(nextPayDate("2026-01-31")).toBe("2026-02-28");
    expect(nextPayDate("2026-12-31")).toBe("2027-01-31");
  });
});

describe("the employer's own copies", () => {
  it("open with the employer's key and give back the team", async () => {
    const { vi } = await import("vitest");
    const { buildPayRun, randomSeed, sealPayslip, toHex } = await import("@phoenix-2203/cista");
    const { envelopeToText, generateSealKeys, recipientOf } = await import("@qorechain/qoreseal");
    const employerKeys = generateSealKeys();
    const rows: TeamRow[] = [row, { ...row, address: "qor1q3tsylvnewfylq576rm5zp08n5yfjv3xd9rf6e", name: "Bayo Adeyemi", staffId: "ACM-0043" }];
    const employer = { ...settings, employer: "qor1qef7x5ac8zwq82ckeyg80j9g3ekdpgwczw8lwh" };
    const run = buildPayRun("qorechain-diana", rows.map((r) => ({ slip: rowToPayslip(r, employer), seed: randomSeed() })));
    const envelopes = run.slips.map((b) => ({
      employee: b.slip.employee.address,
      envelope: envelopeToText(sealPayslip(run, b, { employee: recipientOf(generateSealKeys()), employer: recipientOf(employerKeys) })),
    }));
    const api = await import("../src/lib/api");
    vi.spyOn(api.api, "runEnvelopes").mockResolvedValue(envelopes);
    const { openEmployerCopies } = await import("../src/lib/history");
    const signed = { chainId: run.chainId, employer: run.employer, period: run.period, runRoot: toHex(run.runRoot) } as never;
    const slips = await openEmployerCopies(signed, employerKeys);
    expect(slips.map(payslipToRow)).toEqual(rows);
    await expect(openEmployerCopies(signed, generateSealKeys())).rejects.toThrow(/earlier key/);
  });
});
