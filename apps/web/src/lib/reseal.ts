/**
 * Re-sealing a pay run: after an employee loses their key and publishes a new
 * one, the employer opens their own copy of each payslip (every payslip is
 * sealed to the employer too) and seals it again to the employee's current
 * key card. The payslips themselves don't change, so they still match the run
 * root the employer signed, and the employee's browser checks that.
 */
import { fromHex, openPayslip, sealPayslip, type SignedRun } from "@phoenix-2203/cista";
import { envelopeFromText, envelopeToText, recipientOf, type SealKeyPair } from "@qorechain/qoreseal";
import { api } from "./api";
import { resolveRecipient } from "./payrun";

export interface ResealResult {
  resealed: string[];
  failed: { employee: string; reason: string }[];
}

export async function resealRun(run: SignedRun, employerKeys: SealKeyPair): Promise<ResealResult> {
  const envelopes = await api.runEnvelopes(run.runRoot);
  const ctx = { chainId: run.chainId, employer: run.employer, period: run.period, runRoot: fromHex(run.runRoot) };
  const out: ResealResult = { resealed: [], failed: [] };
  for (const e of envelopes) {
    try {
      let opened;
      try {
        opened = openPayslip({ envelope: envelopeFromText(e.envelope), keys: employerKeys, ...ctx, employee: e.employee });
      } catch {
        throw new Error(
          "your copy is sealed to an earlier key of yours. Recover that key with its recovery phrase (My key → Forgot your password?), then re-seal",
        );
      }
      const to = await resolveRecipient(e.employee);
      const sealed = sealPayslip(ctx, opened.slip, { employee: to.recipient, employer: recipientOf(employerKeys) });
      await api.reseal(run.runRoot, e.employee, envelopeToText(sealed));
      out.resealed.push(e.employee);
    } catch (err) {
      out.failed.push({ employee: e.employee, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
