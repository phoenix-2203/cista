/**
 * Turning the employer's team table into payslips.
 *
 * Statutory lines follow Nigerian rules: pension 8% from the employee and 10%
 * from the employer on basic + housing + transport (Pension Reform Act 2014),
 * and NHF at 2.5% of basic. PAYE is typed in by the employer for now.
 * Payouts are made in testnet QOR at a rate the employer sets.
 */
import type { Payslip } from "@phoenix-2203/cista";

export interface TeamRow {
  address: string;
  name: string;
  staffId: string;
  role: string;
  employedSince: string;
  /** Naira amounts as typed (e.g. "300000" or "300,000.50"). */
  basic: string;
  housing: string;
  transport: string;
  paye: string;
}

export interface RunSettings {
  employer: string;
  employerName: string;
  period: string;
  payDate: string;
  /** Naira per 1 QOR. */
  nairaPerQor: string;
  /** Net-pay thresholds in naira that every payslip answers yes or no to. */
  thresholds: string[];
}

export const DEFAULT_THRESHOLDS = ["100000", "250000", "500000", "1000000"];

export const emptyRow = (): TeamRow => ({
  address: "",
  name: "",
  staffId: "",
  role: "",
  employedSince: "",
  basic: "",
  housing: "",
  transport: "",
  paye: "",
});

/** "300,000.50" naira to kobo. */
export function toKobo(naira: string): bigint {
  const s = naira.replace(/[,\s₦]/g, "");
  if (s === "") return 0n;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`"${naira}" is not an amount in naira`);
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

/** Rounds a percentage of an amount to the nearest kobo (half up). */
export function percentOf(kobo: bigint, basisPoints: bigint): bigint {
  return (kobo * basisPoints + 5_000n) / 10_000n;
}

export function lines(row: TeamRow) {
  const basic = toKobo(row.basic);
  const housing = toKobo(row.housing);
  const transport = toKobo(row.transport);
  const pensionable = basic + housing + transport;
  const pension = percentOf(pensionable, 800n);
  const employerPension = percentOf(pensionable, 1_000n);
  const nhf = percentOf(basic, 250n);
  const paye = toKobo(row.paye);
  const gross = pensionable;
  const net = gross - pension - nhf - paye;
  return { basic, housing, transport, pension, employerPension, nhf, paye, gross, net };
}

/** Net pay in kobo to a payout in uqor at the employer's rate. */
export function payoutUqor(netKobo: bigint, nairaPerQor: string): bigint {
  const rateKobo = toKobo(nairaPerQor);
  if (rateKobo <= 0n) throw new Error("set how many naira one QOR is worth");
  return (netKobo * 1_000_000n) / rateKobo;
}

export function rowToPayslip(row: TeamRow, s: RunSettings): Payslip {
  const l = lines(row);
  if (l.net <= 0n) throw new Error(`${row.name || row.address}: deductions are larger than pay`);
  return {
    version: 1,
    employer: { address: s.employer, name: s.employerName.trim() },
    employee: {
      address: row.address.trim(),
      name: row.name.trim(),
      staffId: row.staffId.trim(),
      role: row.role.trim(),
      employedSince: row.employedSince,
    },
    period: s.period,
    payDate: s.payDate,
    currency: "NGN",
    earnings: [
      { code: "basic", label: "Basic salary", amount: l.basic },
      ...(l.housing > 0n ? [{ code: "housing", label: "Housing allowance", amount: l.housing }] : []),
      ...(l.transport > 0n ? [{ code: "transport", label: "Transport allowance", amount: l.transport }] : []),
    ],
    deductions: [
      ...(l.paye > 0n ? [{ code: "paye", label: "PAYE tax", amount: l.paye }] : []),
      { code: "pension", label: "Pension (8%)", amount: l.pension },
      ...(l.nhf > 0n ? [{ code: "nhf", label: "National Housing Fund (2.5%)", amount: l.nhf }] : []),
    ],
    employerContributions: [{ code: "pension", label: "Employer pension (10%)", amount: l.employerPension }],
    payout: { address: row.address.trim(), denom: "uqor", amount: payoutUqor(l.net, s.nairaPerQor) },
    thresholds: s.thresholds.filter((t) => t.trim() !== "").map(toKobo),
  };
}

const CSV_COLUMNS: (keyof TeamRow)[] = ["address", "name", "staffId", "role", "employedSince", "basic", "housing", "transport", "paye"];

export function teamToCsv(rows: TeamRow[]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n");
}

export function teamFromCsv(text: string): TeamRow[] {
  const records: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) records.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) records.push(row);
  const [head, ...body] = records;
  if (!head) return [];
  const idx = CSV_COLUMNS.map((c) => head.findIndex((h) => h.trim() === c));
  if (idx[0] === -1) throw new Error('the CSV needs an "address" column');
  return body.map((r) => {
    const out = emptyRow();
    CSV_COLUMNS.forEach((c, j) => { if (idx[j]! >= 0) out[c] = (r[idx[j]!] ?? "").trim(); });
    return out;
  });
}
