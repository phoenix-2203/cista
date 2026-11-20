/**
 * Check a proof of pay, with no wallet and no sign-in. Every key and the
 * payment are read from the chain; nothing in the proof is taken on trust.
 * The proof travels in the link's #fragment, which browsers never send to a
 * server.
 */
import { useEffect, useState } from "react";
import { decodeProofBundle, verifyProofBundle, type Verdict } from "@phoenix-2203/cista";
import { errorText, Notice, short } from "../components";
import { chain, EXPLORER_TX } from "../lib/chain";
import { fieldName, fieldValue } from "../lib/fields";

export function Verify() {
  const [text, setText] = useState(() => decodeURIComponent(location.hash.slice(1)));
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (input: string) => {
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      const raw = input.includes("#") ? input.slice(input.indexOf("#") + 1) : input;
      setVerdict(await verifyProofBundle(decodeProofBundle(raw), chain));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (text) void check(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1>Check a proof of pay</h1>
      <p className="muted">
        Someone sent you a Cista proof of pay. This page checks it against QoreChain's testnet: the employer's and the employee's post-quantum
        signatures, and the payment itself. No wallet needed.
      </p>
      {!verdict && (
        <div className="card">
          <label htmlFor="proof">Proof link</label>
          <textarea id="proof" placeholder="https://…/verify#cista-proof:…" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" style={{ marginTop: "0.8rem" }} disabled={busy || !text.trim()} onClick={() => check(text)}>
            {busy ? "Checking against the chain…" : "Check"}
          </button>
        </div>
      )}
      {error && <Notice kind="bad">{error}</Notice>}
      {verdict && <VerdictView verdict={verdict} onReset={() => { setVerdict(null); setText(""); history.replaceState(null, "", "/verify"); }} />}
    </>
  );
}

function VerdictView({ verdict, onReset }: { verdict: Verdict; onReset: () => void }) {
  const fields = verdict.fields ?? {};
  const shown = Object.keys(fields).filter((n) => n !== "employee.address");
  return (
    <>
      <div className={`card`} style={{ borderColor: verdict.ok ? "var(--ok)" : "var(--bad)", borderWidth: 2 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{verdict.ok ? "This proof checks out" : "This proof does not check out"}</h2>
          <span className={`pill ${verdict.ok ? "ok" : "bad"}`}>{verdict.ok ? "Verified" : "Refused"}</span>
        </div>
        {verdict.ok && (
          <p className="muted" style={{ marginTop: "0.6rem" }}>
            For <strong>{verdict.audience}</strong>, valid until {new Date(verdict.expires!).toUTCString()}.
          </p>
        )}
      </div>

      {verdict.ok && (
        <div className="slip" style={{ marginBottom: "1.2rem" }}>
          <header>
            <div>
              <h3 style={{ margin: 0 }}>What the employee chose to show</h3>
              <span className="small muted">Everything else on the payslip stays sealed.</span>
            </div>
          </header>
          <table>
            <tbody>
              <tr><td>Employee's account</td><td className="hash">{verdict.employee}</td></tr>
              <tr><td>Employer's account</td><td className="hash">{verdict.employer}</td></tr>
              <tr><td>Pay period</td><td>{verdict.period}</td></tr>
              {shown.map((n) => (
                <tr key={n}><td>{fieldName(n)}</td><td><strong>{fieldValue(n, fields[n]!)}</strong></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3>What was checked</h3>
        <ul className="checks">
          {verdict.checks.map((c) => (
            <li key={c.id} className={c.ok ? "ok" : "bad"}>
              <span className="mark">{c.ok ? "✓" : "✕"}</span>
              <div>{c.text}</div>
            </li>
          ))}
        </ul>
        {verdict.payment && (
          <p className="small" style={{ marginTop: "0.8rem" }}>
            Payment: <a href={EXPLORER_TX + verdict.payment.hash} target="_blank" rel="noreferrer">{short(verdict.payment.hash)}</a>
            {verdict.payment.time && <> · {new Date(verdict.payment.time).toUTCString()}</>}
          </p>
        )}
      </div>
      <button className="btn ghost" onClick={onReset}>Check another proof</button>
    </>
  );
}
