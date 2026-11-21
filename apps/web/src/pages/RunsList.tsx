/** The employer's past pay runs, as the server holds them. */
import { useEffect, useState } from "react";
import { Notice, payout, short, useAction } from "../components";
import { api, type StoredRun } from "../lib/api";
import { EXPLORER_TX } from "../lib/chain";
import { unlockedKeys } from "../lib/keys";
import { resealRun } from "../lib/reseal";

export function RunsList() {
  const [runs, setRuns] = useState<StoredRun[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const reseal = (r: StoredRun) =>
    run(async () => {
      const keys = unlockedKeys(r.run.employer);
      if (!keys) throw new Error("unlock your Cista key first");
      const res = await resealRun(r.run, keys);
      setNote(
        `${r.run.period}: re-sealed ${res.resealed.length} payslip${res.resealed.length === 1 ? "" : "s"} to each employee's current key.` +
          (res.failed.length ? ` Not re-sealed: ${res.failed.map((f) => `${short(f.employee)} (${f.reason})`).join("; ")}.` : ""),
      );
    });

  useEffect(() => {
    void run(async () => setRuns(await api.myRuns()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!runs && error) return <Notice kind="bad">{error}</Notice>;
  if (!runs || runs.length === 0) return null;
  return (
    <div className="card">
      <h2 className="h3">Your pay runs</h2>
      <p className="small muted">An employee who lost their key and made a new one? Re-seal the run: you open your own copy of each payslip and seal it again to their new key.</p>
      {note && <Notice kind="ok">{note}</Notice>}
      {error && <Notice kind="bad">{error}</Notice>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Period</th><th className="num">Payslips</th><th className="num">Paid out</th><th>Fingerprint</th><th>Payment</th><th /></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run.runRoot}>
                <td>{r.run.period}</td>
                <td className="num">{r.run.count}</td>
                <td className="num">{payout(r.run.totalPayout, r.run.denom)}</td>
                <td className="hash">{short(r.run.runRoot)}</td>
                <td>
                  {r.payment ? (
                    <a href={EXPLORER_TX + r.payment.txHash} target="_blank" rel="noreferrer"><span className="pill ok">Paid · block {r.payment.height}</span></a>
                  ) : (
                    <span className="pill seal">Not paid</span>
                  )}
                </td>
                <td><button className="btn ghost small" disabled={busy} onClick={() => reseal(r)}>Re-seal</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
