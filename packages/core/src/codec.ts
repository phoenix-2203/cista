/**
 * JSON form of a payslip. Amounts travel as decimal strings, because JSON
 * numbers lose precision past 2^53 and bigint does not serialise at all.
 * Parsing is strict: unknown keys are refused, and the result is validated.
 */
import { validatePayslip, type PayLine, type Payslip } from "./payslip";

export interface PayLineJson {
  code: string;
  label: string;
  amount: string;
}

export interface PayslipJson {
  version: 1;
  employer: { address: string; name: string };
  employee: { address: string; name: string; staffId: string; role: string; employedSince: string };
  period: string;
  payDate: string;
  currency: string;
  earnings: PayLineJson[];
  deductions: PayLineJson[];
  employerContributions: PayLineJson[];
  payout: { address: string; denom: string; amount: string };
  thresholds: string[];
}

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}

const line = (l: PayLine): PayLineJson => ({ code: l.code, label: l.label, amount: l.amount.toString() });

export function payslipToJson(slip: Payslip): PayslipJson {
  return {
    version: slip.version,
    employer: { address: slip.employer.address, name: slip.employer.name },
    employee: { ...slip.employee },
    period: slip.period,
    payDate: slip.payDate,
    currency: slip.currency,
    earnings: slip.earnings.map(line),
    deductions: slip.deductions.map(line),
    employerContributions: slip.employerContributions.map(line),
    payout: { address: slip.payout.address, denom: slip.payout.denom, amount: slip.payout.amount.toString() },
    thresholds: slip.thresholds.map(String),
  };
}

function obj(label: string, v: unknown, keys: string[]): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new CodecError(`${label} must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new CodecError(`${label} has an unknown key "${k}"`);
  for (const k of keys) if (!(k in o)) throw new CodecError(`${label} is missing "${k}"`);
  return o;
}

function str(label: string, v: unknown): string {
  if (typeof v !== "string") throw new CodecError(`${label} must be a string`);
  return v;
}

function int(label: string, v: unknown): bigint {
  const s = str(label, v);
  if (!/^(0|[1-9]\d{0,38})$/.test(s)) throw new CodecError(`${label} must be a whole number written in digits`);
  return BigInt(s);
}

function arr(label: string, v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new CodecError(`${label} must be a list`);
  return v;
}

function lines(label: string, v: unknown): PayLine[] {
  return arr(label, v).map((x, i) => {
    const o = obj(`${label}[${i}]`, x, ["code", "label", "amount"]);
    return { code: str(`${label}[${i}].code`, o.code), label: str(`${label}[${i}].label`, o.label), amount: int(`${label}[${i}].amount`, o.amount) };
  });
}

export function payslipFromJson(json: unknown): Payslip {
  const o = obj("payslip", json, [
    "version", "employer", "employee", "period", "payDate", "currency",
    "earnings", "deductions", "employerContributions", "payout", "thresholds",
  ]);
  if (o.version !== 1) throw new CodecError("unsupported payslip version");
  const employer = obj("employer", o.employer, ["address", "name"]);
  const employee = obj("employee", o.employee, ["address", "name", "staffId", "role", "employedSince"]);
  const payout = obj("payout", o.payout, ["address", "denom", "amount"]);
  const slip: Payslip = {
    version: 1,
    employer: { address: str("employer.address", employer.address), name: str("employer.name", employer.name) },
    employee: {
      address: str("employee.address", employee.address),
      name: str("employee.name", employee.name),
      staffId: str("employee.staffId", employee.staffId),
      role: str("employee.role", employee.role),
      employedSince: str("employee.employedSince", employee.employedSince),
    },
    period: str("period", o.period),
    payDate: str("payDate", o.payDate),
    currency: str("currency", o.currency),
    earnings: lines("earnings", o.earnings),
    deductions: lines("deductions", o.deductions),
    employerContributions: lines("employerContributions", o.employerContributions),
    payout: { address: str("payout.address", payout.address), denom: str("payout.denom", payout.denom), amount: int("payout.amount", payout.amount) },
    thresholds: arr("thresholds", o.thresholds).map((t, i) => int(`thresholds[${i}]`, t)),
  };
  try {
    validatePayslip(slip);
  } catch (e) {
    throw new CodecError((e as Error).message);
  }
  return slip;
}
