/** The employee's payslips: opened in this browser, and turned into proofs of pay. */
import { useEffect, useState } from "react";
import { fromHex, grossPay, netPay, openPayslip, totalDeductions, type OpenedPayslip, type SignedRun } from "@phoenix-2203/cista";
import { envelopeFromText } from "@qorechain/qoreseal";
import { money, NeedsKey, Notice, payout, short, useAction } from "../components";
import { api, type StoredRun } from "../lib/api";
import { fieldValue } from "../lib/fields";
import { CHAIN_ID } from "../lib/qorex";
import { unlockedKeys } from "../lib/keys";
import { ProofMaker } from "./ProofMaker";

export interface InboxEntry {
  run: SignedRun;
  payment?: StoredRun["payment"];
  opened?: OpenedPayslip;
  problem?: string;
}

export function Payslips() {
  return (
    <>
      <h1>My payslips</h1>
      <p className="muted">Your payslips arrive sealed. They are opened here, with your key, and checked against the pay run your employer signed.</p>
      <NeedsKey why="Your payslips are sealed to your account.">{(address) => <Inbox address={address} />}</NeedsKey>
    </>
  );
}

function Inbox({ address }: { address: string }) {
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const { error, run } = useAction();

  useEffect(() => {
    void run(async () => {
      const keys = unlockedKeys(address)!;
      const items = await api.inbox();
      setEntries(
        items.map((i) => {
          try {
            const opened = openPayslip({
              envelope: envelopeFromText(i.envelope),
              keys,
              chainId: CHAIN_ID,
              employer: i.run.employer,
              period: i.run.period,
              employee: address,
              runRoot: fromHex(i.run.runRoot),
            });
            return { run: i.run, payment: i.payment, opened };
          } catch (e) {
            return { run: i.run, payment: i.payment, problem: (e as Error).message };
          }
        }),
      );
    });
  }, [address]);

  if (error) return <Notice kind="bad">{error}</Notice>;
  if (!entries) return <div className="card">Fetching your sealed payslips…</div>;
  if (entries.length === 0) return <div className="card">No payslips yet. When an employer pays you through Cista, it appears here.</div>;

  const current = selected === null ? null : entries[selected];
  return (
    <>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Period</th><th>Employer</th><th className="num">Net pay</th><th>Payment</th><th /></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.run.runRoot}>
                  <td>{e.run.period}</td>
                  <td>{e.opened?.slip.slip.employer.name ?? short(e.run.employer)}</td>
                  <td className="num">{e.opened ? money(netPay(e.opened.slip.slip), e.opened.slip.slip.currency) : "—"}</td>
                  <td>{e.payment ? <span className="pill ok">Paid</span> : <span className="pill seal">Not paid yet</span>}</td>
                  <td>
                    {e.opened ? (
                      <button className="btn ghost small" onClick={() => setSelected(i)}>Open</button>
                    ) : (
                      <span className="pill bad" title={e.problem}>Can't open</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.some((e) => e.problem) && (
          <p className="small muted">"Can't open" means the payslip was sealed to an earlier key of yours. If you have that key's recovery phrase, use it on My key → Forgot your password?. If not, ask your employer to press Re-seal on that pay run: they can, as long as they still have the key they used when they paid it.</p>
        )}
      </div>
      {current?.opened && (
        <>
          <PayslipView entry={current} />
          <ProofMaker address={address} entry={current} />
        </>
      )}
    </>
  );
}

function PayslipView({ entry }: { entry: InboxEntry }) {
  const s = entry.opened!.slip.slip;
  const cur = s.currency;
  return (
    <div className="slip" style={{ marginBottom: "1.2rem" }}>
      <header>
        <div>
          <h2 style={{ marginBottom: 0 }}>{s.employer.name}</h2>
          <span className="small muted">Payslip for {s.period} · paid {s.payDate}{s.payFrequency ? ` · ${fieldValue("payFrequency", s.payFrequency)}` : ""}</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="small muted">Net pay</div>
          <div className="net">{money(netPay(s), cur)}</div>
        </div>
      </header>
      <div className="grid" style={{ marginBottom: "1rem" }}>
        <div><div className="small muted">Employee</div>{s.employee.name} · {s.employee.staffId}</div>
        <div><div className="small muted">Role</div>{s.employee.role}</div>
        <div><div className="small muted">Employed since</div>{s.employee.employedSince}</div>
      </div>
      <table>
        <tbody>
          {s.earnings.map((l) => <tr key={`e${l.code}`}><td>{l.label}</td><td className="num">{money(l.amount, cur)}</td></tr>)}
          <tr><th>Gross pay</th><th className="num">{money(grossPay(s), cur)}</th></tr>
          {s.deductions.map((l) => <tr key={`d${l.code}`}><td>{l.label}</td><td className="num">−{money(l.amount, cur)}</td></tr>)}
          <tr><th>Total deductions</th><th className="num">−{money(totalDeductions(s), cur)}</th></tr>
          {s.employerContributions.map((l) => <tr key={`c${l.code}`}><td className="muted">{l.label} (paid by employer)</td><td className="num muted">{money(l.amount, cur)}</td></tr>)}
        </tbody>
      </table>
      {s.yearToDate && (
        <div className="grid ytd" style={{ marginTop: "1rem" }}>
          <div><div className="small muted">Gross this year</div>{money(s.yearToDate.gross, cur)}</div>
          <div><div className="small muted">Deductions this year</div>−{money(s.yearToDate.deductions, cur)}</div>
          <div><div className="small muted">Net this year</div><strong>{money(s.yearToDate.gross - s.yearToDate.deductions, cur)}</strong></div>
        </div>
      )}
      <p className="small muted" style={{ marginTop: "1rem" }}>
        Paid {payout(s.payout.amount, s.payout.denom)} to {short(s.payout.address)}. This payslip matches the pay run {short(entry.run.runRoot)} your employer signed with ML-DSA-87.
      </p>
    </div>
  );
}
