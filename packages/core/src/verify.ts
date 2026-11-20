/**
 * The full check a lender (or anyone) runs on a proof of pay, with no wallet.
 *
 * A proof bundle holds the employee's signed disclosure, the employer's signed
 * pay run and the hash of the payment transaction. Every key and the payment
 * are read from the chain, never from the bundle, so a bundle can only ever
 * pass if the chain agrees with it.
 */
import { DisclosureError } from "./disclose";
import { checkRunPayment, paidTo, type PaymentTx } from "./payment";
import { SignatureError, verifySignedProof, verifySignedRun, type SignedProof, type SignedRun } from "./sign";

export interface ProofBundle {
  v: 1;
  proof: SignedProof;
  run: SignedRun;
  /** Hash of the transaction that paid the run. */
  paymentTx: string;
}

export interface RegisteredKey {
  publicKey: Uint8Array;
  possessionProven: boolean;
}

/** What the checker needs from the chain. The web app and the tests each supply one. */
export interface ChainReader {
  /** The account's registered ML-DSA-87 key, or null if it has none. */
  pqKey(address: string): Promise<RegisteredKey | null>;
  /** The payment transaction, or null if the chain does not know it. */
  paymentTx(hash: string): Promise<PaymentTx | null>;
}

export type CheckId = "fields" | "employee" | "employer" | "same-run" | "payment" | "payout";

export interface Check {
  id: CheckId;
  ok: boolean;
  /** One plain sentence for the person checking. */
  text: string;
}

export interface Verdict {
  ok: boolean;
  checks: Check[];
  /** The revealed fields, only when every check passed. */
  fields?: Record<string, string>;
  employee?: string;
  employer?: string;
  period?: string;
  audience?: string;
  expires?: string;
  payment?: { hash: string; height: number; time?: string };
}

function message(e: unknown): string {
  return e instanceof DisclosureError || e instanceof SignatureError || e instanceof Error ? e.message : String(e);
}

export async function verifyProofBundle(bundle: ProofBundle, chain: ChainReader, now: Date = new Date()): Promise<Verdict> {
  const checks: Check[] = [];
  const add = (id: CheckId, ok: boolean, text: string) => checks.push({ id, ok, text });
  const done = (): Verdict => ({ ok: false, checks });

  if (bundle?.v !== 1 || !bundle.proof || !bundle.run || typeof bundle.paymentTx !== "string") {
    add("fields", false, "This is not a Cista proof of pay.");
    return done();
  }
  const { proof, run } = bundle;

  // 1 + 2: the fields and the employee's signature.
  const employee = proof.disclosure?.fields?.find((f) => f.name === "employee.address")?.value;
  const employeeKey = employee ? await chain.pqKey(employee) : null;
  if (!employeeKey) {
    add("employee", false, "The employee has no post-quantum key registered on chain.");
    return done();
  }
  let checked;
  try {
    checked = verifySignedProof(proof, employeeKey.publicKey, now);
  } catch (e) {
    const fieldsProblem = e instanceof DisclosureError;
    add(fieldsProblem ? "fields" : "employee", false, message(e));
    return done();
  }
  add("fields", true, "The shown fields come from one payslip in the pay run, unchanged.");
  add("employee", true, `Signed by the employee ${checked.employee}${employeeKey.possessionProven ? " (key registered with proof of possession)" : ""}, for "${proof.terms.audience}", valid until ${new Date(proof.terms.expires).toISOString()}.`);

  // 3: the employer's signature over the run.
  const employerKey = await chain.pqKey(run.employer);
  if (!employerKey) {
    add("employer", false, "The employer has no post-quantum key registered on chain.");
    return done();
  }
  try {
    verifySignedRun(run, employerKey.publicKey);
  } catch (e) {
    add("employer", false, message(e));
    return done();
  }
  add("employer", true, `The pay run was signed by the employer ${run.employer} with ML-DSA-87.`);

  // 4: the proof and the signed run are the same run.
  const d = proof.disclosure;
  const same = d.runRoot === run.runRoot && d.employer === run.employer && d.period === run.period && d.chainId === run.chainId;
  add("same-run", same, same ? `Same pay run: ${run.period}, ${run.count} ${run.count === 1 ? "payslip" : "payslips"}.` : "The proof is from a different pay run than the one the employer signed.");
  if (!same) return done();

  // 5: the chain paid that run.
  const tx = await chain.paymentTx(bundle.paymentTx);
  if (!tx) {
    add("payment", false, "The chain does not know the payment transaction.");
    return done();
  }
  const pay = checkRunPayment(tx, run);
  add("payment", pay.ok, pay.ok ? `Paid on chain in one hybrid-signed transaction (block ${tx.height}).` : pay.problems.join(" "));
  if (!pay.ok) return done();

  // 6: if the payout is shown, the employee really received it.
  const f = checked.fields;
  if (f["payout.address"] !== undefined && f["payout.amount"] !== undefined) {
    const got = paidTo(tx, run.employer, f["payout.address"], run.denom);
    const ok = got === BigInt(f["payout.amount"]);
    add("payout", ok, ok ? `${f["payout.amount"]}${run.denom} reached ${f["payout.address"]} in that transaction.` : "The shown payout does not match what the transaction paid.");
    if (!ok) return done();
  }

  return {
    ok: true,
    checks,
    fields: f,
    employee: checked.employee,
    employer: run.employer,
    period: run.period,
    audience: proof.terms.audience,
    expires: proof.terms.expires,
    payment: { hash: tx.hash, height: tx.height, time: tx.time },
  };
}

const BUNDLE_PREFIX = "cista-proof:";

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** The bundle as one line of text, for a link or a QR code. */
export function encodeProofBundle(bundle: ProofBundle): string {
  return BUNDLE_PREFIX + b64urlEncode(new TextEncoder().encode(JSON.stringify(bundle)));
}

export function decodeProofBundle(text: string): ProofBundle {
  const t = text.trim();
  if (!t.startsWith(BUNDLE_PREFIX)) throw new Error("this is not a Cista proof of pay");
  if (t.length > 200_000) throw new Error("this proof is too large");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64urlDecode(t.slice(BUNDLE_PREFIX.length))));
  } catch {
    throw new Error("this proof of pay is damaged");
  }
}
