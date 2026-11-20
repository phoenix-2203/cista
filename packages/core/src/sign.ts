/**
 * Signatures over Cista statements: hybrid secp256k1 + ML-DSA-87, made in
 * QoreX (`signArbitrary`) or by QoreSign, and always checked against the
 * ML-DSA-87 key the signer has registered on chain, never against a key the
 * signature brings along. A classical-only signature is refused: that is the
 * part a quantum computer could forge.
 */
import { verifyMessage, type MessageSignature } from "@qorechain/qoresign";
import { checkDisclosure, proofStatement, type CheckedDisclosure, type Disclosure, type ProofTerms } from "./disclose";
import { runStatement, type PayRun } from "./run";

export type { MessageSignature };

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureError";
  }
}

/** A pay run as the employer signed it. */
export interface SignedRun {
  chainId: string;
  employer: string;
  period: string;
  denom: string;
  /** Decimal string, base units. */
  totalPayout: string;
  count: number;
  /** hex */
  runRoot: string;
  signature: MessageSignature;
}

export function signedRunStatement(r: Omit<SignedRun, "signature">): string {
  if (!/^[0-9a-f]{64}$/.test(r.runRoot)) throw new SignatureError("run root must be 32 bytes of lowercase hex");
  if (!/^(0|[1-9]\d*)$/.test(r.totalPayout)) throw new SignatureError("total payout must be a whole number");
  const runRoot = new Uint8Array(32);
  for (let i = 0; i < 32; i++) runRoot[i] = parseInt(r.runRoot.slice(i * 2, i * 2 + 2), 16);
  return runStatement({ ...r, totalPayout: BigInt(r.totalPayout), runRoot });
}

export function unsignedRun(run: PayRun): Omit<SignedRun, "signature"> {
  let runRoot = "";
  for (const b of run.runRoot) runRoot += b.toString(16).padStart(2, "0");
  return {
    chainId: run.chainId,
    employer: run.employer,
    period: run.period,
    denom: run.denom,
    totalPayout: run.totalPayout.toString(),
    count: run.slips.length,
    runRoot,
  };
}

function check(chainId: string, signer: string, text: string, signature: MessageSignature, pqPublicKey: Uint8Array, what: string): void {
  if (signature?.signatureType !== "ml-dsa-87-hybrid" || !signature.pq) {
    throw new SignatureError(`${what} is not post-quantum signed (no ML-DSA-87 part)`);
  }
  try {
    verifyMessage({ chainId, signer, data: text, signature, pqPublicKey, requirePq: true });
  } catch {
    throw new SignatureError(`${what} does not verify against ${signer}'s registered ML-DSA-87 key`);
  }
}

/** Checks the employer's signature over a pay run. */
export function verifySignedRun(r: SignedRun, employerPqKey: Uint8Array): void {
  check(r.chainId, r.employer, signedRunStatement(r), r.signature, employerPqKey, "the pay run signature");
}

/** A disclosure handed to someone, signed by the employee it is about. */
export interface SignedProof {
  disclosure: Disclosure;
  terms: ProofTerms;
  signature: MessageSignature;
}

/**
 * Checks the disclosure's fields lead to its run root, that the employee whose
 * payslip it is signed it, and that it has not expired. Does not check the
 * employer's run signature or the payment.
 */
export function verifySignedProof(p: SignedProof, employeePqKey: Uint8Array, now: Date = new Date()): CheckedDisclosure {
  const checked = checkDisclosure(p.disclosure);
  check(p.disclosure.chainId, checked.employee, proofStatement(p.disclosure, p.terms), p.signature, employeePqKey, "the proof of pay");
  if (Date.parse(p.terms.expires) <= now.getTime()) throw new SignatureError("this proof of pay has expired");
  return checked;
}
