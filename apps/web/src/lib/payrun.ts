/**
 * The employer's pay run, step by step:
 *   check the team → build and sign the run → seal and upload → pay → record.
 * Each step is a function the page calls; nothing here keeps state.
 */
import {
  buildPayRun,
  multiSendMessages,
  payRunGas,
  randomSeed,
  runMemo,
  sealPayslip,
  sendMessages as sendMsgs,
  signedRunStatement,
  unsignedRun,
  type PayRun,
  type Payslip,
  type SignedRun,
} from "@phoenix-2203/cista";
import { envelopeToText, recipientOf, verifyRecipientCard, type SealKeyPair, type SealRecipient } from "@qorechain/qoreseal";
import { api, ApiError } from "./api";
import { kemKeyOf, pqKeyOf, waitForTx } from "./chain";
import { CHAIN_ID, sendMessages, signText, WalletError } from "./qorex";

export interface ResolvedRecipient {
  address: string;
  recipient: SealRecipient;
  /** "hybrid" with a checked card, "mlkem" with the registered key only. */
  mode: "hybrid" | "mlkem";
}

export class NotReady extends Error {}

/** The keys an employee has published, checked against the chain. */
export async function resolveRecipient(address: string): Promise<ResolvedRecipient> {
  const [kem, pq] = await Promise.all([kemKeyOf(address), pqKeyOf(address)]);
  if (!pq) throw new NotReady("has no post-quantum signing key registered yet (they need to use QoreX once)");
  if (!kem) throw new NotReady("hasn't set up a Cista key yet: send them to the Set up page");
  try {
    const card = await api.card(address);
    const recipient = verifyRecipientCard({ card, chainId: CHAIN_ID, address, pqPublicKey: pq.publicKey, mlkemPublicKey: kem });
    return { address, recipient, mode: "hybrid" };
  } catch (e) {
    if (e instanceof ApiError && e.status !== 404) throw e;
    // No card, or one for an older key: seal with the registered ML-KEM-1024 key alone.
    return { address, recipient: { mlkemPublicKey: kem }, mode: "mlkem" };
  }
}

export function buildRun(payslips: Payslip[]): PayRun {
  return buildPayRun(CHAIN_ID, payslips.map((slip) => ({ slip, seed: randomSeed() })));
}

/** The employer signs the run's statement in QoreX. */
export async function signRun(run: PayRun): Promise<SignedRun> {
  const body = unsignedRun(run);
  const signature = await signText(run.employer, signedRunStatement(body));
  return { ...body, signature };
}

export function sealRun(run: PayRun, recipients: Map<string, ResolvedRecipient>, employerKeys: SealKeyPair) {
  return run.slips.map((s) => {
    const r = recipients.get(s.slip.employee.address);
    if (!r) throw new Error(`no key for ${s.slip.employee.address}`);
    const envelope = sealPayslip(run, s, { employee: r.recipient, employer: recipientOf(employerKeys) });
    return { employee: s.slip.employee.address, envelope: envelopeToText(envelope) };
  });
}

export async function uploadRun(signed: SignedRun, envelopes: { employee: string; envelope: string }[]) {
  try {
    await api.uploadRun(signed, envelopes);
  } catch (e) {
    // Already stored (a retry after a dropped connection) is fine.
    if (!(e instanceof ApiError && e.status === 409)) throw e;
  }
}

export type PayMode = "multi-send" | "sends";

/**
 * Pays the run in one hybrid-signed transaction carrying the run root in its
 * memo. If QoreX can't show a MsgMultiSend, the page can retry with one
 * MsgSend per payslip (up to 32) in the same single transaction.
 */
export async function payRun(run: PayRun, mode: PayMode): Promise<string> {
  const messages = mode === "multi-send" ? multiSendMessages(run) : sendMsgs(run);
  const r = await sendMessages(messages, { memo: runMemo(run.runRoot), gasLimit: payRunGas(run.slips.length) });
  return r.txHash.toUpperCase();
}

export async function recordPayment(runRoot: string, txHash: string) {
  await waitForTx(txHash);
  return api.recordPayment(runRoot, txHash);
}

export function cannotShow(e: unknown): boolean {
  return e instanceof WalletError && e.kind === "cannot-show";
}
