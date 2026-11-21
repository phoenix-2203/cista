/**
 * Turning the employer's team table into payslips.
 *
 * Payslips are in US dollars and paid in fUSD, the fest's dollar stablecoin,
 * one to one: $1 of net pay is 1 fUSD on chain, so there is no exchange rate
 * to set or trust. fUSD is an ERC-20 token that also lives on QoreChain's
 * native lane as the bank denom below, which is what lets one hybrid-signed
 * multi-send pay the whole team.
 *
 * Every payslip also answers "is net pay at least $X?" for a ladder of bands,
 * so an employee can prove a band (or a range between two bands) without
 * showing the amount.
 */
import type { PayFrequency, Payslip } from "@phoenix-2203/cista";

export const FUSD = {
  denom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA",
  symbol: "fUSD",
  decimals: 6,
} as const;

/** Monthly net-pay bands, in dollars. */
export const PAY_BANDS = [250, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 10000, 12000, 15000, 20000, 25000, 30000, 40000, 50000];

/** Year-to-date net-pay bands, in dollars: what "earned at least $X this year" can prove. */
export const YTD_BANDS = [5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 75000, 100000, 125000, 150000, 200000, 250000, 300000, 500000];

export const FREQUENCIES: { value: PayFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "weekly", label: "Weekly" },
];

/** Earlier pay this calendar year for one person, in cents. */
export interface PriorYear {
  gross: bigint;
  deductions: bigint;
}

export interface TeamRow {
  address: string;
  name: string;
  staffId: string;
  role: string;
  employedSince: string;
  /** Dollar amounts as typed (e.g. "3000" or "3,000.50"). */
  basic: string;
  allowances: string;
  bonus: string;
  tax: string;
  pension: string;
  otherDeductions: string;
  /** Paid by the employer on top of gross pay; not taken from the employee. */
  employerPension: string;
}

export interface RunSettings {
  employer: string;
  employerName: string;
  period: string;
  payDate: string;
  payFrequency: PayFrequency;
}

export const emptyRow = (): TeamRow => ({
  address: "",
  name: "",
  staffId: "",
  role: "",
  employedSince: "",
  basic: "",
  allowances: "",
  bonus: "",
  tax: "",
  pension: "",
  otherDeductions: "",
  employerPension: "",
});

/** "3,000.50" dollars to cents. */
export function toCents(dollars: string): bigint {
  const s = dollars.replace(/[,\s$]/g, "");
  if (s === "") return 0n;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`"${dollars}" is not an amount in dollars`);
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

export function lines(row: TeamRow) {
  const basic = toCents(row.basic);
  const allowances = toCents(row.allowances);
  const bonus = toCents(row.bonus);
  const tax = toCents(row.tax);
  const pension = toCents(row.pension);
  const other = toCents(row.otherDeductions);
  const employerPension = toCents(row.employerPension ?? "");
  const gross = basic + allowances + bonus;
  const net = gross - tax - pension - other;
  return { basic, allowances, bonus, tax, pension, other, employerPension, gross, net };
}

/** Net pay in cents to fUSD base units (6 decimals): $1 = 1 fUSD. */
export function centsToFusd(cents: bigint): bigint {
  return cents * 10n ** BigInt(FUSD.decimals - 2);
}

/**
 * One row to a payslip. `prior` is this person's earlier pay this calendar
 * year (from the employer's own copies); with it the payslip carries
 * year-to-date totals and bands.
 */
export function rowToPayslip(row: TeamRow, s: RunSettings, prior?: PriorYear): Payslip {
  const l = lines(row);
  if (l.basic <= 0n) throw new Error(`${row.name || row.address || "a row"}: add a basic salary`);
  if (l.net <= 0n) throw new Error(`${row.name || row.address}: deductions are larger than pay`);
  const line = (code: string, label: string, amount: bigint) => (amount > 0n ? [{ code, label, amount }] : []);
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
    currency: "USD",
    earnings: [...line("basic", "Basic salary", l.basic), ...line("allowances", "Allowances", l.allowances), ...line("bonus", "Bonus", l.bonus)],
    deductions: [...line("tax", "Income tax", l.tax), ...line("pension", "Pension", l.pension), ...line("other", "Other deductions", l.other)],
    employerContributions: line("pension", "Employer pension contribution", l.employerPension),
    payout: { address: row.address.trim(), denom: FUSD.denom, amount: centsToFusd(l.net) },
    thresholds: PAY_BANDS.map((d) => BigInt(d) * 100n),
    payFrequency: s.payFrequency,
    yearToDate: {
      gross: (prior?.gross ?? 0n) + l.gross,
      deductions: (prior?.deductions ?? 0n) + l.tax + l.pension + l.other,
      thresholds: YTD_BANDS.map((d) => BigInt(d) * 100n),
    },
  };
}

/** Cents back to the dollars a person would type: 300050n → "3000.50", 300000n → "3000". */
export function centsToDollars(cents: bigint): string {
  if (cents === 0n) return "";
  const whole = cents / 100n;
  const rest = cents % 100n;
  return rest === 0n ? whole.toString() : `${whole}.${rest.toString().padStart(2, "0")}`;
}

/** A payslip back to a team row, to start a new run from an earlier one. */
export function payslipToRow(slip: Payslip): TeamRow {
  const amount = (list: Payslip["earnings"], code: string) => centsToDollars(list.find((l) => l.code === code)?.amount ?? 0n);
  return {
    address: slip.employee.address,
    name: slip.employee.name,
    staffId: slip.employee.staffId,
    role: slip.employee.role,
    employedSince: slip.employee.employedSince,
    basic: amount(slip.earnings, "basic"),
    allowances: amount(slip.earnings, "allowances"),
    bonus: amount(slip.earnings, "bonus"),
    tax: amount(slip.deductions, "tax"),
    pension: amount(slip.deductions, "pension"),
    otherDeductions: amount(slip.deductions, "other"),
    employerPension: amount(slip.employerContributions, "pension"),
  };
}

const CSV_COLUMNS: (keyof TeamRow)[] = ["address", "name", "staffId", "role", "employedSince", "basic", "allowances", "bonus", "tax", "pension", "otherDeductions", "employerPension"];

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
