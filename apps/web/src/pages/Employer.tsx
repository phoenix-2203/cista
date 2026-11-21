/** The employer's page: build the team table, then run payroll in five steps. */
import { useEffect, useMemo, useState } from "react";
import { statementOf, toHex, type PayRun, type SignedRun } from "@phoenix-2203/cista";
import { money, NeedsKey, Notice, payout, qor, short, useAction } from "../components";
import { api, type StoredRun } from "../lib/api";
import { balanceOf, EXPLORER_TX } from "../lib/chain";
import { nextPayDate, nextPeriod, openEmployerCopies, priorYear } from "../lib/history";
import { unlockedKeys } from "../lib/keys";
import {
  emptyRow,
  FREQUENCIES,
  FUSD,
  lines,
  payslipToRow,
  rowToPayslip,
  teamFromCsv,
  teamToCsv,
  type PriorYear,
  type RunSettings,
  type TeamRow,
} from "../lib/payroll";
import { buildRun, cannotShow, NotReady, payRun, recordPayment, resolveRecipient, sealRun, signRun, uploadRun, type PayMode, type ResolvedRecipient } from "../lib/payrun";
import { Link } from "../lib/router";
import { RunsList } from "./RunsList";

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

export function Employer() {
  return (
    <>
      <h1>Run payroll</h1>
      <p className="muted">
        Each payslip is sealed to its employee before it leaves this browser. You sign the run once in QoreX, then one transaction pays everyone.
      </p>
      <NeedsKey why="Pay runs are signed by your account.">{(address) => <PayrollDesk employer={address} />}</NeedsKey>
    </>
  );
}

type Stage =
  | { kind: "edit" }
  | { kind: "checked"; recipients: Map<string, ResolvedRecipient> }
  | { kind: "signed"; recipients: Map<string, ResolvedRecipient>; run: PayRun; signed: SignedRun }
  | { kind: "uploaded"; run: PayRun; signed: SignedRun }
  | { kind: "paid"; run: PayRun; signed: SignedRun; txHash: string; recorded: boolean };

function PayrollDesk({ employer }: { employer: string }) {
  const [settings, setSettings] = useState<RunSettings>({
    employer,
    employerName: "",
    period: thisMonth(),
    payDate: today(),
    payFrequency: "monthly",
  });
  // Each person's earlier pay this year, found at the check step from your own copies.
  const [prior, setPrior] = useState<{ totals: Map<string, PriorYear>; runs: number }>({ totals: new Map(), runs: 0 });
  const [rows, setRows] = useState<TeamRow[]>([emptyRow()]);
  const [stage, setStage] = useState<Stage>({ kind: "edit" });
  const [problems, setProblems] = useState<Map<number, string>>(new Map());
  const [refresh, setRefresh] = useState(0);
  const { busy, error, setError, run } = useAction();

  const locked = stage.kind !== "edit" && stage.kind !== "checked";
  const edit = (i: number, patch: Partial<TeamRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setStage({ kind: "edit" });
  };

  const computed = useMemo(
    () =>
      rows.map((r) => {
        try {
          const l = lines(r);
          return { ok: true as const, ...l };
        } catch (e) {
          return { ok: false as const, error: (e as Error).message };
        }
      }),
    [rows],
  );

  // Step 1: build the payslips and check every employee has published keys.
  const check = () =>
    run(async () => {
      if (!settings.employerName.trim()) throw new Error("add your company's name");
      const keys = unlockedKeys(employer);
      if (!keys) throw new Error("unlock your Cista key first: it adds up the year so far from your own copies of earlier runs");
      const year = await priorYear(await api.myRuns(), settings.period, keys);
      setPrior(year);
      const found = new Map<number, string>();
      const payslips = rows.map((r, i) => {
        try {
          return rowToPayslip(r, settings, year.totals.get(r.address.trim()));
        } catch (e) {
          found.set(i, (e as Error).message);
          return null;
        }
      });
      const recipients = new Map<string, ResolvedRecipient>();
      await Promise.all(
        rows.map(async (r, i) => {
          if (found.has(i)) return;
          try {
            recipients.set(r.address.trim(), await resolveRecipient(r.address.trim()));
          } catch (e) {
            found.set(i, e instanceof NotReady ? `${short(r.address)} ${e.message}` : (e as Error).message);
          }
        }),
      );
      setProblems(found);
      if (found.size > 0) throw new Error("fix the rows marked below, then check again");
      buildRun(payslips as NonNullable<(typeof payslips)[number]>[]); // validates the whole run (duplicates, one employer…)
      const total = (payslips as NonNullable<(typeof payslips)[number]>[]).reduce((s, p) => s + p.payout.amount, 0n);
      const [fusd, uqor] = await Promise.all([balanceOf(employer, FUSD.denom), balanceOf(employer, "uqor")]);
      if (fusd < total) {
        throw new Error(`this run pays ${payout(total, FUSD.denom)}, and your account holds ${payout(fusd, FUSD.denom)} on QoreChain's native lane. Get test fUSD from the faucet at dashboard.qorechain.io/faucet`);
      }
      if (uqor < 200_000n) throw new Error(`the transaction fee is paid in QOR, and your account holds ${qor(uqor)}`);
      setStage({ kind: "checked", recipients });
    });

  // Step 2: build the run with fresh salts and sign it in QoreX.
  const sign = () =>
    run(async () => {
      if (stage.kind !== "checked") return;
      const payRun = buildRun(rows.map((r) => rowToPayslip(r, settings, prior.totals.get(r.address.trim()))));
      const signed = await signRun(payRun);
      setStage({ kind: "signed", recipients: stage.recipients, run: payRun, signed });
    });

  // Step 3: seal every payslip in this browser and upload ciphertext only.
  const sealAndUpload = () =>
    run(async () => {
      if (stage.kind !== "signed") return;
      const keys = unlockedKeys(employer);
      if (!keys) throw new Error("unlock your Cista key first");
      const envelopes = sealRun(stage.run, stage.recipients, keys);
      await uploadRun(stage.signed, envelopes);
      setStage({ kind: "uploaded", run: stage.run, signed: stage.signed });
      setRefresh((n) => n + 1);
    });

  // Step 4 and 5: pay in one transaction, then record it once the chain shows it.
  const pay = (mode: PayMode) =>
    run(async () => {
      if (stage.kind !== "uploaded") return;
      let txHash: string;
      try {
        txHash = await payRun(stage.run, mode);
      } catch (e) {
        if (mode === "multi-send" && cannotShow(e)) {
          throw new Error("QoreX can't show a multi-send yet. Use \"Pay with separate transfers\": still one transaction, one signature.");
        }
        throw e;
      }
      setStage({ kind: "paid", run: stage.run, signed: stage.signed, txHash, recorded: false });
      await recordPayment(stage.signed.runRoot, txHash);
      setStage({ kind: "paid", run: stage.run, signed: stage.signed, txHash, recorded: true });
      setRefresh((n) => n + 1);
    });

  const retryRecord = () =>
    run(async () => {
      if (stage.kind !== "paid") return;
      await recordPayment(stage.signed.runRoot, stage.txHash);
      setStage({ ...stage, recorded: true });
      setRefresh((n) => n + 1);
    });

  const loadCsv = async (file: File) => {
    try {
      const team = teamFromCsv(await file.text());
      if (team.length === 0) throw new Error("that CSV has no rows");
      setRows(team);
      setStage({ kind: "edit" });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saveCsv = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([teamToCsv(rows)], { type: "text/csv" }));
    a.download = `cista-team-${settings.period}.csv`;
    a.click();
  };

  // Start from an earlier run: open the employer's own copies and copy the team, a month on.
  const startFrom = (r: StoredRun) =>
    run(async () => {
      const keys = unlockedKeys(employer);
      if (!keys) throw new Error("unlock your Cista key first, so it can open your copy of that run");
      const slips = await openEmployerCopies(r.run, keys);
      if (slips.length === 0) throw new Error("that run has no payslips stored");
      setRows(slips.map(payslipToRow));
      const payDate = slips[0]!.payDate;
      setSettings((s) => ({
        ...s,
        employerName: slips[0]!.employer.name,
        period: nextPeriod(r.run.period),
        payDate: nextPayDate(payDate),
        payFrequency: slips[0]!.payFrequency ?? s.payFrequency,
      }));
      setProblems(new Map());
      setStage({ kind: "edit" });
    });

  const total = computed.reduce((s, c) => s + (c.ok ? c.net : 0n), 0n);

  return (
    <>
      <div className="card">
        <h2 className="h3">This pay run</h2>
        <div className="grid">
          <div className="field">
            <label htmlFor="co">Company name</label>
            <input id="co" disabled={locked} value={settings.employerName} onChange={(e) => setSettings({ ...settings, employerName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="period">Period</label>
            <input id="period" type="month" disabled={locked} value={settings.period} onChange={(e) => setSettings({ ...settings, period: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="paydate">Pay date</label>
            <input id="paydate" type="date" disabled={locked} value={settings.payDate} onChange={(e) => setSettings({ ...settings, payDate: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="freq">Pay frequency</label>
            <select id="freq" disabled={locked} value={settings.payFrequency} onChange={(e) => { setSettings({ ...settings, payFrequency: e.target.value as RunSettings["payFrequency"] }); setStage({ kind: "edit" }); }}>
              {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>
        <p className="small muted">
          Payslips are in US dollars and paid in fUSD, one to one. Every payslip also answers "is net pay at least…" for a ladder of bands from $250 to
          $50,000 a pay period, and carries year-to-date totals added up from your earlier paid runs this year, so employees can prove a band, a
          range or "earned at least $X this year" without showing the amount.
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="h3" style={{ margin: 0 }}>Team</h2>
          <div className="row">
            {!locked && <StartFrom busy={busy} onPick={startFrom} refresh={refresh} />}
            <label className="btn ghost small" style={{ margin: 0 }}>
              Load CSV
              <input type="file" accept=".csv,text/csv" hidden disabled={locked} onChange={(e) => e.target.files?.[0] && void loadCsv(e.target.files[0])} />
            </label>
            <button className="btn ghost small" onClick={saveCsv}>Download CSV</button>
          </div>
        </div>
        <p className="small muted">
          Amounts per pay period, in US dollars. Employer pension is paid by you on top of pay, not taken from it. Paying the same team again? Start from an earlier run: your key opens your own sealed copy and fills the
          table in, a month on. Cista never stores your team in the clear. One QoreX account is one company; each team keeps its own runs.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Address</th><th>Name</th><th>Staff ID</th><th>Role</th><th>Start date</th>
                <th className="num">Basic</th><th className="num">Allowances</th><th className="num">Bonus</th><th className="num">Tax</th><th className="num">Pension</th><th className="num">Other ded.</th><th className="num">Employer pension</th>
                <th className="num">Net</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const c = computed[i]!;
                return (
                  <tr key={i}>
                    {(["address", "name", "staffId", "role"] as const).map((k) => (
                      <td key={k} style={{ minWidth: k === "address" ? 220 : 120 }}>
                        <input aria-label={k} disabled={locked} value={r[k]} onChange={(e) => edit(i, { [k]: e.target.value })} />
                      </td>
                    ))}
                    <td><input aria-label="start date" type="date" disabled={locked} value={r.employedSince} onChange={(e) => edit(i, { employedSince: e.target.value })} /></td>
                    {(["basic", "allowances", "bonus", "tax", "pension", "otherDeductions", "employerPension"] as const).map((k) => (
                      <td key={k} className="num" style={{ minWidth: 100 }}>
                        <input aria-label={k} inputMode="decimal" disabled={locked} value={r[k]} onChange={(e) => edit(i, { [k]: e.target.value })} />
                      </td>
                    ))}
                    <td className="num">{c.ok ? money(c.net, "USD") : <span className="pill bad">?</span>}</td>
                    <td>
                      {!locked && rows.length > 1 && (
                        <button className="btn ghost small" aria-label="remove row" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setStage({ kind: "edit" }); }}>×</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {[...problems.entries()].map(([i, p]) => (
          <p key={i} className="small" style={{ color: "var(--bad)", margin: "0.4rem 0 0" }}>Row {i + 1}: {p}</p>
        ))}
        <div className="row" style={{ justifyContent: "space-between", marginTop: "0.8rem" }}>
          {!locked ? <button className="btn ghost small" onClick={() => { setRows([...rows, emptyRow()]); setStage({ kind: "edit" }); }}>Add a person</button> : <span />}
          <strong>Total net pay: {money(total, "USD")} = {payout(total * 10_000n, FUSD.denom)}</strong>
        </div>
      </div>

      <div className="card">
        <h2 className="h3">Pay the team</h2>
        <ul className="checks">
          <Step n={1} done={stage.kind !== "edit"} title="Check everyone's keys and your balance">
            {stage.kind === "edit" && <button className="btn small" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check"}</button>}
            {stage.kind === "checked" && (
              <p className="small muted">
                Year to date: added up from {prior.runs === 0 ? "this run alone (no earlier paid runs this year)" : `${prior.runs} earlier paid run${prior.runs === 1 ? "" : "s"} this year and this one`}.{" "}
                {[...stage.recipients.values()].filter((r) => r.mode === "hybrid").length} of {stage.recipients.size} payslips will be sealed with ML-KEM-1024 + X25519; the rest with ML-KEM-1024 alone.
              </p>
            )}
          </Step>
          <Step n={2} done={["signed", "uploaded", "paid"].includes(stage.kind)} title="Sign the pay run in QoreX">
            {stage.kind === "checked" && <button className="btn small" disabled={busy} onClick={sign}>{busy ? "Waiting for QoreX…" : "Sign the run"}</button>}
            {"signed" in stage && (
              <details className="small">
                <summary>What you signed</summary>
                <pre className="hash">{statementOf(stage.run)}</pre>
              </details>
            )}
          </Step>
          <Step n={3} done={stage.kind === "uploaded" || stage.kind === "paid"} title="Seal each payslip and upload the sealed copies">
            {stage.kind === "signed" && <button className="btn small" disabled={busy} onClick={sealAndUpload}>{busy ? "Sealing…" : "Seal and upload"}</button>}
          </Step>
          <Step n={4} done={stage.kind === "paid"} title="Pay everyone in one transaction">
            {stage.kind === "uploaded" && (
              <div className="row">
                <button className="btn small seal" disabled={busy} onClick={() => pay("multi-send")}>{busy ? "Waiting for QoreX…" : `Pay ${payout(stage.run.totalPayout, stage.run.denom)}`}</button>
                {stage.run.slips.length <= 32 && (
                  <button className="btn ghost small" disabled={busy} onClick={() => pay("sends")}>Pay with separate transfers</button>
                )}
              </div>
            )}
            {stage.kind === "paid" && (
              <p className="small"><a href={EXPLORER_TX + stage.txHash} target="_blank" rel="noreferrer">Transaction {short(stage.txHash)}</a></p>
            )}
          </Step>
          <Step n={5} done={stage.kind === "paid" && stage.recorded} title="Check the payment on chain and record it">
            {stage.kind === "paid" && !stage.recorded && (
              <button className="btn small ghost" disabled={busy} onClick={retryRecord}>{busy ? "Checking the chain…" : "Check again"}</button>
            )}
          </Step>
        </ul>
        {error && <Notice kind="bad">{error}</Notice>}
        {stage.kind === "paid" && stage.recorded && (
          <Notice kind="ok">
            Done. Everyone is paid and their sealed payslips are waiting in <Link href="/payslips">My payslips</Link>. Run fingerprint{" "}
            <span className="hash">{toHex(stage.run.runRoot)}</span>
          </Notice>
        )}
      </div>

      <RunsList key={refresh} />
    </>
  );
}

/** Pick an earlier run to copy the team from (each team keeps its own runs). */
function StartFrom({ busy, onPick, refresh }: { busy: boolean; onPick: (r: StoredRun) => void; refresh: number }) {
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [picked, setPicked] = useState("");
  useEffect(() => {
    api.myRuns().then(setRuns, () => setRuns([]));
  }, [refresh]);
  if (runs.length === 0) return null;
  const chosen = runs.find((r) => r.run.runRoot === picked) ?? runs[0]!;
  return (
    <div className="row start-from">
      <select aria-label="Earlier pay run" value={chosen.run.runRoot} onChange={(e) => setPicked(e.target.value)}>
        {runs.map((r) => (
          <option key={r.run.runRoot} value={r.run.runRoot}>
            {r.run.period} · {r.run.count} {r.run.count === 1 ? "person" : "people"} · {payout(r.run.totalPayout, r.run.denom)}{r.payment ? "" : " · not paid"}
          </option>
        ))}
      </select>
      <button className="btn ghost small" disabled={busy} onClick={() => onPick(chosen)}>Start from this run</button>
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className={done ? "ok" : "wait"}>
      <span className="mark">{done ? "✓" : n}</span>
      <div>
        <strong>{title}</strong>
        <div style={{ marginTop: "0.4rem" }}>{children}</div>
      </div>
    </li>
  );
}
