/**
 * Payslip fields in plain language: names, values, groups, the standard proof
 * types, and the sentences a verifier reads.
 *
 * The proof types follow the industry's own terms. Background-check and
 * lending tools (The Work Number, Truv, Argyle) split requests into
 * verification of employment (VOE) and verification of income (VOI); FHE
 * payroll experiments add income above a threshold and income within a range.
 * Cista offers all four as presets over the same per-field disclosure, plus a
 * custom pick.
 */
import { money, payout } from "./format";

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
  payFrequency: "Paid",
  "ytd.gross": "Gross pay this year",
  "ytd.deductions": "Deductions this year",
  "ytd.net": "Net pay this year",
};

const FREQUENCY: Record<string, string> = { weekly: "weekly", biweekly: "every two weeks", semimonthly: "twice a month", monthly: "monthly" };
const PER: Record<string, string> = { weekly: "a week", biweekly: "every two weeks", semimonthly: "a pay period", monthly: "a month" };

/** "a month", "a week"…: what one payslip's pay covers. Older payslips are monthly. */
export function perPeriod(fields: Record<string, string>): string {
  return PER[fields.payFrequency ?? "monthly"] ?? "a pay period";
}

const LINE: Record<string, string> = {
  basic: "basic salary",
  allowances: "allowances",
  bonus: "bonus",
  tax: "income tax",
  pension: "pension",
  other: "other deductions",
  housing: "housing allowance",
  transport: "transport allowance",
  paye: "PAYE tax",
  nhf: "National Housing Fund",
};

const BAND = /^net\.atLeast\.(\d+)$/;
const YTD_BAND = /^ytd\.net\.atLeast\.(\d+)$/;

export function bandOf(name: string): bigint | null {
  const m = BAND.exec(name);
  return m ? BigInt(m[1]!) : null;
}

export function ytdBandOf(name: string): bigint | null {
  const m = YTD_BAND.exec(name);
  return m ? BigInt(m[1]!) : null;
}

export function fieldName(name: string, currency = "USD"): string {
  if (NAMES[name]) return NAMES[name]!;
  const band = bandOf(name);
  if (band !== null) return `Net pay is at least ${money(band, currency)}`;
  const ytdBand = ytdBandOf(name);
  if (ytdBand !== null) return `Net pay this year is at least ${money(ytdBand, currency)}`;
  const [kind, code] = name.split(".");
  if (kind === "earning") return `Earnings: ${LINE[code!] ?? code}`;
  if (kind === "deduction") return `Deduction: ${LINE[code!] ?? code}`;
  if (kind === "employerContribution") return `Employer pays: ${LINE[code!] ?? code}`;
  return name;
}

const MONEY = /^(earning|deduction|employerContribution)\.|^(gross|deductions|net)$|^ytd\.(gross|deductions|net)$/;

export function fieldValue(name: string, value: string, fields: Record<string, string> = {}): string {
  const currency = fields.currency ?? "USD";
  if (MONEY.test(name) && /^\d+$/.test(value)) return money(BigInt(value), currency);
  if (name === "payout.amount" && /^\d+$/.test(value)) return fields["payout.denom"] ? payout(value, fields["payout.denom"]) : value;
  if (name === "payout.denom") return payout(0n, value).replace(/^0 /, "");
  if (bandOf(name) !== null || ytdBandOf(name) !== null) return value === "yes" ? "Yes" : "No";
  if (name === "payFrequency") return FREQUENCY[value] ?? value;
  return value;
}

/** How the custom picker groups the fields. Bands are offered through the presets instead. */
export const GROUPS: { title: string; test: (n: string) => boolean }[] = [
  { title: "Employment", test: (n) => n.startsWith("employer.") || n.startsWith("employee.") },
  { title: "Pay", test: (n) => ["period", "payDate", "payFrequency", "gross", "deductions", "net"].includes(n) },
  { title: "Year to date", test: (n) => ["ytd.gross", "ytd.deductions", "ytd.net"].includes(n) },
  { title: "Paid on chain", test: (n) => n.startsWith("payout.") },
  { title: "Payslip lines", test: (n) => /^(earning|deduction|employerContribution)\./.test(n) },
];

/** Always shown, so never offered as a choice. */
export const ALWAYS = new Set(["employee.address", "currency", "version"]);

export type ProofKind = "employment" | "above" | "range" | "ytd" | "exact" | "custom";

export const PROOF_KINDS: { kind: ProofKind; title: string; blurb: string }[] = [
  { kind: "employment", title: "Employment", blurb: "Who employs you, your role and since when. No pay." },
  { kind: "above", title: "Income above an amount", blurb: "Net pay is at least an amount you pick. The amount itself stays sealed." },
  { kind: "range", title: "Income in a range", blurb: "Net pay is between two amounts. The amount itself stays sealed." },
  { kind: "ytd", title: "Earned this year", blurb: "Net pay so far this year is at least an amount you pick. The total stays sealed." },
  { kind: "exact", title: "Exact pay", blurb: "Net and gross pay, and the payment that reached your account." },
  { kind: "custom", title: "Custom", blurb: "Pick exactly which lines to show." },
];

export const PURPOSES = ["Loan", "Rent", "Mortgage", "Visa", "Credit card", "New job", "Other"] as const;

/** The year-to-date bands a payslip answered, lowest first. */
export function ytdBands(values: Record<string, string>): { name: string; amount: bigint; yes: boolean }[] {
  return Object.keys(values)
    .map((n) => ({ name: n, amount: ytdBandOf(n) }))
    .filter((b): b is { name: string; amount: bigint } => b.amount !== null)
    .sort((a, b) => (a.amount < b.amount ? -1 : 1))
    .map((b) => ({ ...b, yes: values[b.name] === "yes" }));
}

/** The bands a payslip answered, lowest first. */
export function bands(values: Record<string, string>): { name: string; amount: bigint; yes: boolean }[] {
  return Object.keys(values)
    .map((n) => ({ name: n, amount: bandOf(n) }))
    .filter((b): b is { name: string; amount: bigint } => b.amount !== null)
    .sort((a, b) => (a.amount < b.amount ? -1 : 1))
    .map((b) => ({ ...b, yes: values[b.name] === "yes" }));
}

/** The fields a preset shows. `above` and `range` need band names. */
export function presetFields(kind: ProofKind, values: Record<string, string>, opts: { above?: string; from?: string; to?: string; ytd?: string } = {}): string[] {
  const has = (n: string) => n in values;
  const employer = ["employer.name", "period"];
  switch (kind) {
    case "employment":
      return [...employer, "employee.role", "employee.employedSince"].filter(has);
    case "above":
      return [...employer, opts.above].filter((n): n is string => !!n && has(n));
    case "range":
      return [...employer, opts.from, opts.to].filter((n): n is string => !!n && has(n));
    case "ytd":
      return [...employer, opts.ytd].filter((n): n is string => !!n && has(n));
    case "exact":
      return [...employer, "net", "gross", "payout.address", "payout.amount", "payout.denom"].filter(has);
    default:
      return [];
  }
}

/**
 * What a set of revealed fields proves, as sentences a verifier reads at a
 * glance. Bands answered "yes" and "no" combine into a range.
 */
export function claims(fields: Record<string, string>): string[] {
  const currency = fields.currency ?? "USD";
  const out: string[] = [];
  const employer = fields["employer.name"];
  const role = fields["employee.role"];
  const since = fields["employee.employedSince"];
  if (employer || role || since) {
    out.push(
      [
        employer ? `Employed by ${employer}` : "Employed",
        role ? ` as ${role}` : "",
        since ? ` since ${since}` : "",
        fields.period ? `, and on the payroll for ${fields.period}` : "",
        fields.payFrequency ? `, paid ${FREQUENCY[fields.payFrequency] ?? fields.payFrequency}` : "",
      ].join("") + ".",
    );
  }
  const b = bands(fields);
  const highestYes = [...b].reverse().find((x) => x.yes);
  const lowestNo = b.find((x) => !x.yes);
  const when = fields.period ? ` for ${fields.period}` : "";
  if (highestYes && lowestNo) out.push(`Net pay${when} was at least ${money(highestYes.amount, currency)} and less than ${money(lowestNo.amount, currency)}.`);
  else if (highestYes) out.push(`Net pay${when} was at least ${money(highestYes.amount, currency)}.`);
  else if (lowestNo) out.push(`Net pay${when} was less than ${money(lowestNo.amount, currency)}.`);
  if (fields.net) out.push(`Net pay${when} was ${money(BigInt(fields.net), currency)}${fields.gross ? ` (gross ${money(BigInt(fields.gross), currency)})` : ""}.`);
  else if (fields.gross) out.push(`Gross pay${when} was ${money(BigInt(fields.gross), currency)}.`);
  const y = ytdBands(fields);
  const yYes = [...y].reverse().find((x) => x.yes);
  const yNo = y.find((x) => !x.yes);
  const yWhen = fields.period ? ` in ${fields.period.slice(0, 4)}, up to ${fields.period},` : " this year";
  if (yYes && yNo) out.push(`Net pay${yWhen} was at least ${money(yYes.amount, currency)} and less than ${money(yNo.amount, currency)}.`);
  else if (yYes) out.push(`Net pay${yWhen} was at least ${money(yYes.amount, currency)}.`);
  else if (yNo) out.push(`Net pay${yWhen} was less than ${money(yNo.amount, currency)}.`);
  if (fields["ytd.net"]) out.push(`Net pay${yWhen} was ${money(BigInt(fields["ytd.net"]), currency)}${fields["ytd.gross"] ? ` (gross ${money(BigInt(fields["ytd.gross"]), currency)})` : ""}.`);
  else if (fields["ytd.gross"]) out.push(`Gross pay${yWhen} was ${money(BigInt(fields["ytd.gross"]), currency)}.`);
  if (fields["payout.amount"] && fields["payout.address"]) {
    out.push(`${fieldValue("payout.amount", fields["payout.amount"], fields)} was paid to ${fields["payout.address"]}, checked on chain.`);
  }
  return out;
}
