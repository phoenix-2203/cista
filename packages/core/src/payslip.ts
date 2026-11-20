/**
 * The payslip model.
 *
 * A payslip is turned into a flat, ordered list of named fields. Each field is
 * committed to separately, so an employee can later reveal one field (say, net
 * pay) and keep the rest sealed. Money is kept in minor units (kobo for NGN) as
 * bigint, so no rounding can creep in between the browser, the server and the
 * chain.
 */

export const PAYSLIP_VERSION = 1 as const;

export interface PayLine {
  /** Short stable code, e.g. "basic", "housing", "paye", "pension". */
  code: string;
  /** Human label shown on the payslip. Not committed: the code is. */
  label: string;
  /** Minor units (kobo for NGN). */
  amount: bigint;
}

export interface Payslip {
  version: typeof PAYSLIP_VERSION;
  employer: { address: string; name: string };
  employee: {
    address: string;
    name: string;
    staffId: string;
    role: string;
    /** YYYY-MM-DD */
    employedSince: string;
  };
  /** YYYY-MM */
  period: string;
  /** YYYY-MM-DD */
  payDate: string;
  /** ISO 4217 code of the payslip amounts, e.g. "NGN". */
  currency: string;
  earnings: PayLine[];
  deductions: PayLine[];
  /** Paid by the employer on top of gross pay (e.g. the employer's pension share). */
  employerContributions: PayLine[];
  /** What the chain actually paid: the address, the denom and the amount in base units. */
  payout: { address: string; denom: string; amount: bigint };
  /**
   * Net-pay thresholds (minor units) the employer answers yes or no to, so an
   * employee can prove "net pay is at least X" without revealing the amount.
   */
  thresholds: bigint[];
}

/** One committed field: a dotted name and its canonical string value. */
export interface Field {
  name: string;
  value: string;
}

export class PayslipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayslipError";
  }
}

const QOR_ADDRESS = /^qor1[02-9ac-hj-np-z]{38}$/;
const CODE = /^[a-z][a-z0-9]{0,31}$/;
/** A bank denom: "uqor", an IBC denom, or an ERC-20 token's native form ("erc20:0x…", e.g. fUSD). */
const DENOM = /^(?:[a-z][a-z0-9/]{1,63}|erc20:0x[0-9a-fA-F]{40})$/;
const CURRENCY = /^[A-Z]{3}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_LINES = 32;
const MAX_THRESHOLDS = 32;

function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function text(label: string, s: string, max = 120): void {
  if (s.trim() !== s || s.length === 0 || s.length > max) {
    throw new PayslipError(`${label} must be 1 to ${max} characters with no leading or trailing spaces`);
  }
}

function lines(kind: string, list: PayLine[]): void {
  if (list.length > MAX_LINES) throw new PayslipError(`at most ${MAX_LINES} ${kind} lines`);
  const seen = new Set<string>();
  for (const line of list) {
    if (!CODE.test(line.code)) throw new PayslipError(`${kind} code "${line.code}" must be lowercase letters and digits`);
    if (seen.has(line.code)) throw new PayslipError(`${kind} code "${line.code}" appears twice`);
    seen.add(line.code);
    text(`${kind} label`, line.label, 60);
    if (line.amount < 0n) throw new PayslipError(`${kind} "${line.code}" is negative`);
  }
}

export function sumLines(list: PayLine[]): bigint {
  return list.reduce((total, line) => total + line.amount, 0n);
}

export function grossPay(slip: Payslip): bigint {
  return sumLines(slip.earnings);
}

export function totalDeductions(slip: Payslip): bigint {
  return sumLines(slip.deductions);
}

export function netPay(slip: Payslip): bigint {
  return grossPay(slip) - totalDeductions(slip);
}

/** Throws a PayslipError describing the first problem found. */
export function validatePayslip(slip: Payslip): void {
  if (slip.version !== PAYSLIP_VERSION) throw new PayslipError(`unsupported payslip version ${String(slip.version)}`);
  if (!QOR_ADDRESS.test(slip.employer.address)) throw new PayslipError("employer address must be a qor1 address");
  if (!QOR_ADDRESS.test(slip.employee.address)) throw new PayslipError("employee address must be a qor1 address");
  if (!QOR_ADDRESS.test(slip.payout.address)) throw new PayslipError("payout address must be a qor1 address");
  if (slip.employer.address === slip.employee.address) throw new PayslipError("employer and employee must differ");
  text("employer name", slip.employer.name);
  text("employee name", slip.employee.name);
  text("staff ID", slip.employee.staffId, 40);
  text("role", slip.employee.role, 80);
  if (!isDate(slip.employee.employedSince)) throw new PayslipError("employedSince must be a real date (YYYY-MM-DD)");
  if (!PERIOD.test(slip.period)) throw new PayslipError("period must be YYYY-MM");
  if (!isDate(slip.payDate)) throw new PayslipError("payDate must be a real date (YYYY-MM-DD)");
  if (slip.employee.employedSince > slip.payDate) throw new PayslipError("employedSince is after the pay date");
  if (!CURRENCY.test(slip.currency)) throw new PayslipError("currency must be a 3-letter ISO 4217 code");
  if (slip.earnings.length === 0) throw new PayslipError("a payslip needs at least one earning");
  lines("earning", slip.earnings);
  lines("deduction", slip.deductions);
  lines("employer contribution", slip.employerContributions);
  if (netPay(slip) < 0n) throw new PayslipError("deductions are larger than gross pay");
  if (!DENOM.test(slip.payout.denom)) throw new PayslipError("payout denom is not valid");
  if (slip.payout.amount <= 0n) throw new PayslipError("payout amount must be positive");
  if (slip.thresholds.length > MAX_THRESHOLDS) throw new PayslipError(`at most ${MAX_THRESHOLDS} thresholds`);
  const seen = new Set<bigint>();
  for (const t of slip.thresholds) {
    if (t <= 0n) throw new PayslipError("thresholds must be positive");
    if (seen.has(t)) throw new PayslipError("thresholds must be distinct");
    seen.add(t);
  }
}

/**
 * The payslip as an ordered list of committed fields. The order is fixed by
 * this function, so the same payslip always gives the same list.
 */
export function payslipFields(slip: Payslip): Field[] {
  validatePayslip(slip);
  const net = netPay(slip);
  const fields: Field[] = [
    { name: "version", value: String(slip.version) },
    { name: "employer.address", value: slip.employer.address },
    { name: "employer.name", value: slip.employer.name },
    { name: "employee.address", value: slip.employee.address },
    { name: "employee.name", value: slip.employee.name },
    { name: "employee.staffId", value: slip.employee.staffId },
    { name: "employee.role", value: slip.employee.role },
    { name: "employee.employedSince", value: slip.employee.employedSince },
    { name: "period", value: slip.period },
    { name: "payDate", value: slip.payDate },
    { name: "currency", value: slip.currency },
  ];
  for (const l of slip.earnings) fields.push({ name: `earning.${l.code}`, value: l.amount.toString() });
  fields.push({ name: "gross", value: grossPay(slip).toString() });
  for (const l of slip.deductions) fields.push({ name: `deduction.${l.code}`, value: l.amount.toString() });
  fields.push({ name: "deductions", value: totalDeductions(slip).toString() });
  fields.push({ name: "net", value: net.toString() });
  for (const l of slip.employerContributions) {
    fields.push({ name: `employerContribution.${l.code}`, value: l.amount.toString() });
  }
  fields.push({ name: "payout.address", value: slip.payout.address });
  fields.push({ name: "payout.denom", value: slip.payout.denom });
  fields.push({ name: "payout.amount", value: slip.payout.amount.toString() });
  const sorted = [...slip.thresholds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const t of sorted) fields.push({ name: `net.atLeast.${t}`, value: net >= t ? "yes" : "no" });
  return fields;
}
