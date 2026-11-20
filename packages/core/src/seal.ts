/**
 * Sealed payslips (QoreSeal, ML-KEM-1024).
 *
 * Each payslip is sealed to the employee and to the employer, so the employer
 * can re-seal it if the employee ever loses their key. Inside the envelope is
 * the payslip, its 32-byte salt seed and its proof into the run root: all an
 * employee needs to check the payslip and later make a proof of pay.
 *
 * The envelope's additional data binds it to its place: chain, employer,
 * period, employee and run root. A server that swaps two employees' envelopes,
 * or moves one to another run, makes them fail to open. The plaintext is padded
 * to a fixed block size so the envelope's length does not hint at how many pay
 * lines or digits a payslip has. Envelopes are anonymous: they do not say who
 * they are for.
 */
import { open as qsOpen, seal as qsSeal, type SealKeyPair, type SealMode, type SealRecipient } from "@qorechain/qoreseal";
import { concat, equalBytes, fromHex, fromUtf8, toHex, utf8 } from "./bytes";
import { payslipFromJson, payslipToJson, type PayslipJson } from "./codec";
import { commitFields } from "./commit";
import { merkleRoot, rootFromProof } from "./merkle";
import { payslipFields } from "./payslip";
import { slipRootOf, type BuiltSlip, type PayRun } from "./run";

export const PAYSLIP_PURPOSE = "cista-payslip-v1";
export const PAD_BLOCK = 2048;

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

/** What the envelope holds. */
interface PayslipPackage {
  v: 1;
  runRoot: string;
  slipIndex: number;
  slipSiblings: string[];
  seed: string;
  slip: PayslipJson;
}

export interface EnvelopeContext {
  chainId: string;
  employer: string;
  period: string;
  employee: string;
  runRoot: Uint8Array;
}

export function payslipAad(ctx: EnvelopeContext): Uint8Array {
  return utf8(["cista/payslip/v1", ctx.chainId, ctx.employer, ctx.period, ctx.employee, toHex(ctx.runRoot)].join("|"));
}

export function pad(data: Uint8Array): Uint8Array {
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, data.length, false);
  const body = concat(head, data);
  const size = Math.ceil(body.length / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(size);
  out.set(body);
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < 4 || padded.length % PAD_BLOCK !== 0) throw new SealError("payslip padding is not valid");
  const length = new DataView(padded.buffer, padded.byteOffset, 4).getUint32(0, false);
  if (length > padded.length - 4) throw new SealError("payslip padding is not valid");
  for (let i = 4 + length; i < padded.length; i++) if (padded[i] !== 0) throw new SealError("payslip padding is not valid");
  return padded.slice(4, 4 + length);
}

function modeFor(recipients: SealRecipient[]): SealMode {
  return recipients.every((r) => r.x25519PublicKey) ? "hybrid" : "mlkem";
}

export interface PayslipRecipients {
  employee: SealRecipient;
  employer: SealRecipient;
}

export function sealPayslip(run: Pick<PayRun, "chainId" | "employer" | "period" | "runRoot">, slip: BuiltSlip, to: PayslipRecipients): Uint8Array {
  const pkg: PayslipPackage = {
    v: 1,
    runRoot: toHex(run.runRoot),
    slipIndex: slip.runProof.index,
    slipSiblings: slip.runProof.siblings.map(toHex),
    seed: toHex(slip.seed),
    slip: payslipToJson(slip.slip),
  };
  const recipients = [to.employee, to.employer];
  return qsSeal({
    chainId: run.chainId,
    purpose: PAYSLIP_PURPOSE,
    recipients,
    plaintext: pad(utf8(JSON.stringify(pkg))),
    aad: payslipAad({ chainId: run.chainId, employer: run.employer, period: run.period, employee: slip.slip.employee.address, runRoot: run.runRoot }),
    mode: modeFor(recipients),
    anonymous: true,
  });
}

export interface OpenedPayslip {
  run: Pick<PayRun, "chainId" | "employer" | "period" | "runRoot">;
  slip: BuiltSlip;
}

/**
 * Opens a payslip and checks it fits the run root it claims. Throws a
 * SealError if the envelope is not for these keys, was moved, or does not
 * match the run root.
 */
export function openPayslip(args: { envelope: Uint8Array; keys: SealKeyPair } & EnvelopeContext): OpenedPayslip {
  let plaintext: Uint8Array;
  try {
    plaintext = qsOpen({ chainId: args.chainId, purpose: PAYSLIP_PURPOSE, envelope: args.envelope, keys: args.keys, aad: payslipAad(args) });
  } catch {
    throw new SealError("this payslip cannot be opened with these keys, or it was moved from where it was sealed");
  }
  let pkg: PayslipPackage;
  try {
    pkg = JSON.parse(fromUtf8(unpad(plaintext)));
  } catch {
    throw new SealError("the payslip inside the envelope is not readable");
  }
  if (pkg?.v !== 1) throw new SealError("unsupported payslip package version");
  const slip = payslipFromJson(pkg.slip);
  if (slip.employer.address !== args.employer || slip.employee.address !== args.employee || slip.period !== args.period) {
    throw new SealError("the payslip does not belong where it was stored");
  }
  if (!/^[0-9a-f]{64}$/.test(pkg.seed) || !Array.isArray(pkg.slipSiblings)) throw new SealError("the payslip package is malformed");
  const seed = fromHex(pkg.seed);
  const fields = payslipFields(slip);
  const commitments = commitFields(fields, seed);
  const fieldsRoot = merkleRoot(commitments);
  const slipRoot = slipRootOf(fieldsRoot);
  const runProof = { index: pkg.slipIndex, siblings: pkg.slipSiblings.map(fromHex) };
  let root: Uint8Array;
  try {
    root = rootFromProof(slipRoot, runProof);
  } catch {
    throw new SealError("the payslip's proof into the pay run is malformed");
  }
  if (!equalBytes(root, args.runRoot) || pkg.runRoot !== toHex(args.runRoot)) {
    throw new SealError("this payslip is not part of the signed pay run");
  }
  return {
    run: { chainId: args.chainId, employer: args.employer, period: args.period, runRoot: args.runRoot },
    slip: { slip, seed, fields, commitments, fieldsRoot, slipRoot, runProof },
  };
}
