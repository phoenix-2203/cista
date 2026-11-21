/**
 * The employer's own copies of earlier payslips. Every payslip is sealed to
 * the employer as well as the employee, so the employer's key opens them
 * again: to start a new run from an earlier one, or to add up the year so far.
 * Nothing is kept in the clear anywhere; this runs in the employer's browser.
 */
import { fromHex, grossPay, openPayslip, totalDeductions, type Payslip, type SignedRun } from "@phoenix-2203/cista";
import { envelopeFromText, type SealKeyPair } from "@qorechain/qoreseal";
import { api, type StoredRun } from "./api";
import type { PriorYear } from "./payroll";

/** Opens every payslip of a run with the employer's key, in run order. */
export async function openEmployerCopies(run: SignedRun, keys: SealKeyPair): Promise<Payslip[]> {
  const envelopes = await api.runEnvelopes(run.runRoot);
  const ctx = { chainId: run.chainId, employer: run.employer, period: run.period, runRoot: fromHex(run.runRoot) };
  return envelopes.map((e) => {
    try {
      return openPayslip({ envelope: envelopeFromText(e.envelope), keys, ...ctx, employee: e.employee }).slip.slip;
    } catch {
      throw new Error(
        `the ${run.period} run is sealed to an earlier key of yours. Recover that key with its recovery phrase (My key → Forgot your password?), then try again`,
      );
    }
  });
}

/** "2026-11" → "2026-12"; "2026-12" → "2027-01". */
export function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The same day of the next month, clamped to the month's last day. */
export function nextPayDate(payDate: string): string {
  const [y, m, d] = payDate.split("-").map(Number) as [number, number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * Each person's earlier pay this calendar year, from the employer's own
 * copies of paid runs before `period` in the same year. Unpaid runs don't count.
 */
export async function priorYear(runs: StoredRun[], period: string, keys: SealKeyPair): Promise<{ totals: Map<string, PriorYear>; runs: number }> {
  const year = period.slice(0, 4);
  const earlier = runs.filter((r) => r.payment && r.run.period.startsWith(year) && r.run.period < period);
  const totals = new Map<string, PriorYear>();
  for (const r of earlier) {
    for (const slip of await openEmployerCopies(r.run, keys)) {
      const t = totals.get(slip.employee.address) ?? { gross: 0n, deductions: 0n };
      totals.set(slip.employee.address, { gross: t.gross + grossPay(slip), deductions: t.deductions + totalDeductions(slip) });
    }
  }
  return { totals, runs: earlier.length };
}
