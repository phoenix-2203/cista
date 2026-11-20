/** The employer's page: build the team table, then run payroll in five steps. */
import { useMemo, useState } from "react";
import { statementOf, toHex, type PayRun, type SignedRun } from "@phoenix-2203/cista";
import { money, NeedsKey, Notice, payout, qor, short, useAction } from "../components";
import { balanceOf, EXPLORER_TX } from "../lib/chain";
import { unlockedKeys } from "../lib/keys";
import {
  emptyRow,
  FUSD,
  lines,
  rowToPayslip,
  teamFromCsv,
  teamToCsv,
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
  });
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
      const found = new Map<number, string>();
      const payslips = rows.map((r, i) => {
        try {
          return rowToPayslip(r, settings);
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
      const payRun = buildRun(rows.map((r) => rowToPayslip(r, settings)));
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

  const total = computed.reduce((s, c) => s + (c.ok ? c.net : 0n), 0n);

  return (
    <>
      <div className="card">
        <h3>This pay run</h3>
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
        </div>
        <p className="small muted">
          Payslips are in US dollars and paid in fUSD, one to one. Every payslip also answers "is net pay at least…" for a ladder of bands from $250 to
          $50,000 a month, so employees can prove a band or a range without showing the amount.
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Team</h3>
          <div className="row">
            <label className="btn ghost small" style={{ margin: 0 }}>
              Load CSV
              <input type="file" accept=".csv,text/csv" hidden disabled={locked} onChange={(e) => e.target.files?.[0] && void loadCsv(e.target.files[0])} />
            </label>
            <button className="btn ghost small" onClick={saveCsv}>Download CSV</button>
          </div>
        </div>
        <p className="small muted">Monthly amounts in US dollars. The CSV stays on your computer: Cista never stores your team in the clear.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Address</th><th>Name</th><th>Staff ID</th><th>Role</th><th>Start date</th>
                <th className="num">Basic</th><th className="num">Allowances</th><th className="num">Bonus</th><th className="num">Tax</th><th className="num">Pension</th><th className="num">Other ded.</th>
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
                    {(["basic", "allowances", "bonus", "tax", "pension", "otherDeductions"] as const).map((k) => (
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
        <h3>Pay the team</h3>
        <ul className="checks">
          <Step n={1} done={stage.kind !== "edit"} title="Check everyone's keys and your balance">
            {stage.kind === "edit" && <button className="btn small" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check"}</button>}
            {stage.kind === "checked" && (
              <p className="small muted">
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
