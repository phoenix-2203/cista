/**
 * Selective disclosure: show some payslip fields, keep the rest sealed.
 *
 * A disclosure carries, for each revealed field, its value, its salt and its
 * proof up to the payslip's field root, plus the payslip's proof up to the run
 * root. A checker rebuilds the run root from those pieces alone. Unrevealed
 * fields appear only as hashes inside the proofs.
 *
 * `employee.address` is always revealed, so the disclosure says whose payslip
 * it is, and the employee's own signature over it (see `proofStatement`) shows
 * the holder is that employee. The statement names who the proof is for and
 * when it expires, so a lender cannot pass it on as fresh.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, equalBytes, fromHex, lengthPrefixed, toHex, utf8 } from "./bytes";
import { fieldCommitment, fieldSalt } from "./commit";
import { merkleProof, rootFromProof, type MerkleProof } from "./merkle";
import { slipRootOf, type BuiltSlip, type PayRun } from "./run";

export const DISCLOSURE_VERSION = 1 as const;
export const REQUIRED_FIELDS = ["employee.address"] as const;

export interface RevealedField {
  name: string;
  value: string;
  /** hex, 32 bytes */
  salt: string;
  index: number;
  /** hex, 32 bytes each */
  siblings: string[];
}

export interface Disclosure {
  v: typeof DISCLOSURE_VERSION;
  chainId: string;
  employer: string;
  period: string;
  /** hex, 32 bytes */
  runRoot: string;
  slipIndex: number;
  slipSiblings: string[];
  fields: RevealedField[];
}

export class DisclosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisclosureError";
  }
}

export function createDisclosure(run: Pick<PayRun, "chainId" | "employer" | "period" | "runRoot">, slip: BuiltSlip, names: string[]): Disclosure {
  const wanted = new Set<string>([...REQUIRED_FIELDS, ...names]);
  const fields: RevealedField[] = [];
  slip.fields.forEach((field, index) => {
    if (!wanted.has(field.name)) return;
    wanted.delete(field.name);
    const proof = merkleProof(slip.commitments, index);
    fields.push({
      name: field.name,
      value: field.value,
      salt: toHex(fieldSalt(slip.seed, field.name)),
      index: proof.index,
      siblings: proof.siblings.map(toHex),
    });
  });
  if (wanted.size > 0) throw new DisclosureError(`this payslip has no field ${[...wanted].join(", ")}`);
  return {
    v: DISCLOSURE_VERSION,
    chainId: run.chainId,
    employer: run.employer,
    period: run.period,
    runRoot: toHex(run.runRoot),
    slipIndex: slip.runProof.index,
    slipSiblings: slip.runProof.siblings.map(toHex),
    fields,
  };
}

const HEX32 = /^[0-9a-f]{64}$/;

function hex32(label: string, s: string): Uint8Array {
  if (typeof s !== "string" || !HEX32.test(s)) throw new DisclosureError(`${label} must be 32 bytes of lowercase hex`);
  return fromHex(s);
}

function proofOf(label: string, index: number, siblings: string[]): MerkleProof {
  if (!Number.isInteger(index) || index < 0) throw new DisclosureError(`${label} index is not valid`);
  if (!Array.isArray(siblings) || siblings.length > 16) throw new DisclosureError(`${label} proof is not valid`);
  return { index, siblings: siblings.map((s) => hex32(`${label} proof`, s)) };
}

export interface CheckedDisclosure {
  runRoot: Uint8Array;
  /** The employee whose payslip this is. */
  employee: string;
  fields: Record<string, string>;
}

/**
 * Checks that every revealed field belongs to one payslip in the run with the
 * stated root. It does NOT check the employer's signature, the payment or the
 * employee's signature: see `verify` for the full check.
 */
export function checkDisclosure(d: Disclosure): CheckedDisclosure {
  if (d?.v !== DISCLOSURE_VERSION) throw new DisclosureError("unsupported disclosure version");
  const runRoot = hex32("run root", d.runRoot);
  if (!Array.isArray(d.fields) || d.fields.length === 0 || d.fields.length > 64) throw new DisclosureError("a disclosure reveals 1 to 64 fields");

  let fieldsRoot: Uint8Array | null = null;
  const fields: Record<string, string> = {};
  const indexes = new Set<number>();
  for (const f of d.fields) {
    if (typeof f.name !== "string" || typeof f.value !== "string") throw new DisclosureError("field name and value must be text");
    if (Object.hasOwn(fields, f.name)) throw new DisclosureError(`field ${f.name} is revealed twice`);
    if (indexes.has(f.index)) throw new DisclosureError("two fields claim the same position");
    indexes.add(f.index);
    const commitment = fieldCommitment({ name: f.name, value: f.value }, hex32(`salt of ${f.name}`, f.salt));
    let root: Uint8Array;
    try {
      root = rootFromProof(commitment, proofOf(f.name, f.index, f.siblings));
    } catch {
      throw new DisclosureError(`proof of ${f.name} is not valid`);
    }
    if (fieldsRoot && !equalBytes(root, fieldsRoot)) throw new DisclosureError(`${f.name} is not from the same payslip as the other fields`);
    fieldsRoot = root;
    fields[f.name] = f.value;
  }
  for (const name of REQUIRED_FIELDS) {
    if (!Object.hasOwn(fields, name)) throw new DisclosureError(`a disclosure must reveal ${name}`);
  }

  let computed: Uint8Array;
  try {
    computed = rootFromProof(slipRootOf(fieldsRoot!), proofOf("payslip", d.slipIndex, d.slipSiblings));
  } catch {
    throw new DisclosureError("the payslip's proof is not valid");
  }
  if (!equalBytes(computed, runRoot)) throw new DisclosureError("the fields do not lead to the stated run root");
  if (fields["employer.address"] !== undefined && fields["employer.address"] !== d.employer) {
    throw new DisclosureError("the revealed employer does not match the disclosure");
  }
  if (fields["period"] !== undefined && fields["period"] !== d.period) {
    throw new DisclosureError("the revealed period does not match the disclosure");
  }
  return { runRoot, employee: fields["employee.address"]!, fields };
}

/** A fixed-order byte encoding of the disclosure, for hashing. */
export function disclosureDigest(d: Disclosure): Uint8Array {
  const parts: Uint8Array[] = [
    utf8("cista/disclosure/v1"),
    lengthPrefixed(utf8(d.chainId)),
    lengthPrefixed(utf8(d.employer)),
    lengthPrefixed(utf8(d.period)),
    lengthPrefixed(utf8(d.runRoot)),
    lengthPrefixed(utf8(String(d.slipIndex))),
    lengthPrefixed(utf8(d.slipSiblings.join(","))),
  ];
  for (const f of d.fields) {
    parts.push(
      lengthPrefixed(utf8(f.name)),
      lengthPrefixed(utf8(f.value)),
      lengthPrefixed(utf8(f.salt)),
      lengthPrefixed(utf8(String(f.index))),
      lengthPrefixed(utf8(f.siblings.join(","))),
    );
  }
  return sha256(concat(...parts));
}

export interface ProofTerms {
  /** Who the proof is for, e.g. "Zenith Lending, loan application 4471". */
  audience: string;
  /** ISO 8601 time after which the proof should be refused. */
  expires: string;
}

/** The readable text the employee signs in QoreX to hand a disclosure to someone. */
export function proofStatement(d: Disclosure, terms: ProofTerms): string {
  const audience = terms.audience.trim();
  if (audience.length === 0 || audience.length > 120 || /[\r\n]/.test(audience)) {
    throw new DisclosureError("say who the proof is for in one line of up to 120 characters");
  }
  if (Number.isNaN(Date.parse(terms.expires))) throw new DisclosureError("expiry must be a date and time");
  return [
    "Cista proof of pay v1",
    `Chain: ${d.chainId}`,
    `For: ${audience}`,
    `Expires: ${new Date(terms.expires).toISOString()}`,
    `Shows: ${d.fields.map((f) => f.name).join(", ")}`,
    `Proof: ${toHex(disclosureDigest(d))}`,
  ].join("\n");
}
