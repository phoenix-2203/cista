/** Plain-language names and values for payslip fields, for the proof picker and the verify page. */
import { money, qor } from "../components";

const NAMES: Record<string, string> = {
  version: "Payslip format",
  "employer.address": "Employer's account",
  "employer.name": "Employer",
  "employee.address": "Employee's account",
  "employee.name": "Name",
  "employee.staffId": "Staff ID",
  "employee.role": "Role",
  "employee.employedSince": "Employed since",
  period: "Pay period",
  payDate: "Pay date",
  currency: "Currency",
  gross: "Gross pay",
  deductions: "Total deductions",
  net: "Net pay",
  "payout.address": "Paid to",
  "payout.denom": "Paid in",
  "payout.amount": "Amount paid on chain",
};

const LINE: Record<string, string> = {
  basic: "basic salary",
  housing: "housing allowance",
  transport: "transport allowance",
  paye: "PAYE tax",
  pension: "pension",
  nhf: "National Housing Fund",
};

export function fieldName(name: string): string {
  if (NAMES[name]) return NAMES[name]!;
  const [kind, code, extra] = name.split(".");
  if (kind === "earning") return `Earnings: ${LINE[code!] ?? code}`;
  if (kind === "deduction") return `Deduction: ${LINE[code!] ?? code}`;
  if (kind === "employerContribution") return `Employer pays: ${LINE[code!] ?? code}`;
  if (kind === "net" && code === "atLeast" && extra) return `Net pay is at least ${money(BigInt(extra))}`;
  return name;
}

const MONEY = /^(earning|deduction|employerContribution)\.|^(gross|deductions|net)$/;

export function fieldValue(name: string, value: string, currency = "NGN"): string {
  if (MONEY.test(name) && /^\d+$/.test(value)) return money(BigInt(value), currency);
  if (name === "payout.amount" && /^\d+$/.test(value)) return qor(value);
  if (name.startsWith("net.atLeast.")) return value === "yes" ? "Yes" : "No";
  return value;
}

/** Fields offered in the proof picker, in a sensible order. Always-shown fields are left out. */
export const PICKABLE_ORDER = [
  "employer.name",
  "employee.name",
  "employee.role",
  "employee.employedSince",
  "period",
  "net.atLeast.",
  "net",
  "gross",
  "payout.address",
  "payout.amount",
];

export function pickable(names: string[]): string[] {
  const order = (n: string) => {
    const i = PICKABLE_ORDER.findIndex((p) => (p.endsWith(".") ? n.startsWith(p) : n === p));
    return i === -1 ? PICKABLE_ORDER.length : i;
  };
  return names.filter((n) => n !== "employee.address" && n !== "version").sort((a, b) => order(a) - order(b));
}
