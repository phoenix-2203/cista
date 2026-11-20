/** The employer's past pay runs, as the server holds them. */
import { useEffect, useState } from "react";
import { Notice, qor, short, useAction } from "../components";
import { api, type StoredRun } from "../lib/api";
import { EXPLORER_TX } from "../lib/chain";

export function RunsList() {
  const [runs, setRuns] = useState<StoredRun[] | null>(null);
  const { error, run } = useAction();

  useEffect(() => {
    void run(async () => setRuns(await api.myRuns()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Notice kind="bad">{error}</Notice>;
  if (!runs || runs.length === 0) return null;
  return (
    <div className="card">
      <h3>Your pay runs</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Period</th><th className="num">Payslips</th><th className="num">Paid out</th><th>Fingerprint</th><th>Payment</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run.runRoot}>
                <td>{r.run.period}</td>
                <td className="num">{r.run.count}</td>
                <td className="num">{qor(r.run.totalPayout)}</td>
                <td className="hash">{short(r.run.runRoot)}</td>
                <td>
                  {r.payment ? (
                    <a href={EXPLORER_TX + r.payment.txHash} target="_blank" rel="noreferrer"><span className="pill ok">Paid · block {r.payment.height}</span></a>
                  ) : (
                    <span className="pill seal">Not paid</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
