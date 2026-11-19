/**
 * A pay run: one employer, one period, one payslip per employee.
 *
 * Fingerprints, bottom up:
 *
 *   field commitments  ──Merkle──▶  slip root   (one per payslip)
 *   slip roots         ──Merkle──▶  run root    (one per pay run)
 *
 * The run root is what the employer signs in QoreX and what the payment
 * transaction carries in its memo. Anyone holding one payslip, or one revealed
 * field with its proofs, can climb back up to the run root and check it against
 * the signature and the payment.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, toHex, utf8 } from "./bytes";
import { commitFields } from "./commit";
import { merkleProof, merkleRoot, type MerkleProof } from "./merkle";
import { payslipFields, type Field, type Payslip } from "./payslip";

export const SLIP_DOMAIN = "cista/slip/v1";
export const MEMO_PREFIX = "cista:v1:";
export const MAX_PAYSLIPS = 500;

export class PayRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayRunError";
  }
}

/** A payslip with the random seed its field salts come from. */
export interface SealedSlipInput {
  slip: Payslip;
  seed: Uint8Array;
}

export interface BuiltSlip {
  slip: Payslip;
  seed: Uint8Array;
  fields: Field[];
  commitments: Uint8Array[];
  /** Root of the field tree. */
  fieldsRoot: Uint8Array;
  /** The value placed in the run tree: SHA-256(SLIP_DOMAIN || fieldsRoot). */
  slipRoot: Uint8Array;
  /** Proof that slipRoot is in the run tree. */
  runProof: MerkleProof;
}

export interface PayRun {
  chainId: string;
  employer: string;
  period: string;
  denom: string;
  totalPayout: bigint;
  slips: BuiltSlip[];
  runRoot: Uint8Array;
}

export function slipRootOf(fieldsRoot: Uint8Array): Uint8Array {
  return sha256(concat(utf8(SLIP_DOMAIN), fieldsRoot));
}

export function buildPayRun(chainId: string, inputs: SealedSlipInput[]): PayRun {
  if (!/^[a-z0-9-]{1,64}$/.test(chainId)) throw new PayRunError("chain ID is not valid");
  if (inputs.length === 0) throw new PayRunError("a pay run needs at least one payslip");
  if (inputs.length > MAX_PAYSLIPS) throw new PayRunError(`at most ${MAX_PAYSLIPS} payslips per run`);
  const first = inputs[0]!.slip;
  const employees = new Set<string>();
  const payouts = new Set<string>();
  let total = 0n;
  for (const { slip } of inputs) {
    if (slip.employer.address !== first.employer.address) throw new PayRunError("every payslip must have the same employer");
    if (slip.employer.name !== first.employer.name) throw new PayRunError("every payslip must name the employer the same way");
    if (slip.period !== first.period) throw new PayRunError("every payslip must be for the same period");
    if (slip.payout.denom !== first.payout.denom) throw new PayRunError("every payslip must pay out in the same denom");
    if (employees.has(slip.employee.address)) throw new PayRunError(`${slip.employee.address} has two payslips`);
    if (payouts.has(slip.payout.address)) throw new PayRunError(`${slip.payout.address} is the payout address of two payslips`);
    if (slip.payout.address === slip.employer.address) throw new PayRunError("a payout address cannot be the employer");
    employees.add(slip.employee.address);
    payouts.add(slip.payout.address);
    total += slip.payout.amount;
  }

  const partial = inputs.map(({ slip, seed }) => {
    const fields = payslipFields(slip);
    const commitments = commitFields(fields, seed);
    const fieldsRoot = merkleRoot(commitments);
    return { slip, seed, fields, commitments, fieldsRoot, slipRoot: slipRootOf(fieldsRoot) };
  });
  const slipRoots = partial.map((p) => p.slipRoot);
  const runRoot = merkleRoot(slipRoots);
  const slips = partial.map((p, i) => ({ ...p, runProof: merkleProof(slipRoots, i) }));

  return {
    chainId,
    employer: first.employer.address,
    period: first.period,
    denom: first.payout.denom,
    totalPayout: total,
    slips,
    runRoot,
  };
}

/** The memo the payment transaction carries. */
export function runMemo(runRoot: Uint8Array): string {
  return MEMO_PREFIX + toHex(runRoot);
}

export function parseRunMemo(memo: string): Uint8Array | null {
  const m = /^cista:v1:([0-9a-f]{64})$/.exec(memo.trim());
  if (!m) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(m[1]!.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The readable statement the employer signs in QoreX. QoreX shows this text
 * before signing, so the employer sees what they are vouching for.
 */
export function runStatement(run: Pick<PayRun, "chainId" | "employer" | "period" | "denom" | "totalPayout" | "runRoot"> & { count: number }): string {
  return [
    "Cista pay run v1",
    `Chain: ${run.chainId}`,
    `Employer: ${run.employer}`,
    `Period: ${run.period}`,
    `Payslips: ${run.count}`,
    `Total payout: ${run.totalPayout}${run.denom}`,
    `Run root: ${toHex(run.runRoot)}`,
  ].join("\n");
}

export function statementOf(run: PayRun): string {
  return runStatement({ ...run, count: run.slips.length });
}
