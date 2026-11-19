import type { Payslip } from "../src/payslip";

/**
 * Test-only addresses: valid qor1 bech32, made from sha256("cista-fixture-<name>").
 * Nobody holds keys for them. Never send funds to them.
 */
export const ADDR = {
  employer: "qor1lhn3955g79jfmuzvqmcz3msyr57qx78eyvlanh",
  ada: "qor1k3lpzfetuf09e7d85rsc8mrsxeg53mzuz7nqj3",
  bayo: "qor1g65nhydslp29cl7tqzh6vr5ghft34x4msfxnvc",
  chidi: "qor1k88dhgk3vz9y4r256krs4v0k0vzlnt0c03824e",
  adaPayout: "qor14zcktsxvx6gfaevk64hqnc9hnyjgh0swvxdjen",
} as const;

/** ₦ to kobo. */
export const naira = (n: number): bigint => BigInt(Math.round(n * 100));

/** A sample payslip. The PAYE figure is a placeholder, not a tax calculation. */
export function sampleSlip(overrides: Partial<Payslip> = {}): Payslip {
  return {
    version: 1,
    employer: { address: ADDR.employer, name: "Acme Logistics Ltd" },
    employee: {
      address: ADDR.ada,
      name: "Ada Obi",
      staffId: "ACM-0042",
      role: "Operations Analyst",
      employedSince: "2025-03-01",
    },
    period: "2026-11",
    payDate: "2026-11-28",
    currency: "NGN",
    earnings: [
      { code: "basic", label: "Basic salary", amount: naira(300_000) },
      { code: "housing", label: "Housing allowance", amount: naira(120_000) },
      { code: "transport", label: "Transport allowance", amount: naira(60_000) },
    ],
    deductions: [
      { code: "paye", label: "PAYE tax", amount: naira(52_000) },
      { code: "pension", label: "Pension (8%)", amount: naira(38_400) },
      { code: "nhf", label: "National Housing Fund", amount: naira(7_500) },
    ],
    employerContributions: [{ code: "pension", label: "Employer pension (10%)", amount: naira(48_000) }],
    payout: { address: ADDR.adaPayout, denom: "uqor", amount: 382_100_000n },
    thresholds: [naira(500_000), naira(100_000), naira(250_000)],
    ...overrides,
  };
}
