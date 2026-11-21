/**
 * Check a proof of pay, with no wallet and no sign-in. Every key and the
 * payment are read from the chain; nothing in the proof is taken on trust.
 * The proof travels in the link's #fragment, which browsers never send to a
 * server.
 */
import { useEffect, useState } from "react";
import { decodeProofBundle, verifyProofBundle, type ProofBundle, type Verdict } from "@phoenix-2203/cista";
import { parseAddress } from "@qorechain/qoresign";
import { errorText, Notice, short } from "../components";
import { chain, EXPLORER_TX } from "../lib/chain";
import { claims, fieldName, fieldValue } from "../lib/fields";
import { checkOnChain, EXPLORER_ADDRESS, VERIFIER, type OnChainResult } from "../lib/onchain";

export function Verify() {
  const [text, setText] = useState(() => decodeURIComponent(location.hash.slice(1)));
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [bundle, setBundle] = useState<ProofBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (input: string) => {
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      const raw = input.includes("#") ? input.slice(input.indexOf("#") + 1) : input;
      const b = decodeProofBundle(raw);
      setBundle(b);
      setVerdict(await verifyProofBundle(b, chain));
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
      {verdict && <VerdictView verdict={verdict} bundle={bundle} onReset={() => { setVerdict(null); setBundle(null); setText(""); history.replaceState(null, "", "/verify"); }} />}
    </>
  );
}

const HIDDEN = new Set(["employee.address", "employer.address", "currency", "period", "version"]);

function VerdictView({ verdict, bundle, onReset }: { verdict: Verdict; bundle: ProofBundle | null; onReset: () => void }) {
  const fields = verdict.fields ?? {};
  const shown = Object.keys(fields).filter((n) => !HIDDEN.has(n));
  return (
    <>
      <div className="card" style={{ borderColor: verdict.ok ? "var(--ok)" : "var(--bad)", borderWidth: 2 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{verdict.ok ? "This proof checks out" : "This proof does not check out"}</h2>
          <span className={`pill ${verdict.ok ? "ok" : "bad"}`}>{verdict.ok ? "Verified" : "Refused"}</span>
        </div>
        {verdict.ok && (
          <>
            <ul className="claims">
              {claims({ ...fields, period: verdict.period ?? fields.period ?? "" }).map((c) => <li key={c}>{c}</li>)}
            </ul>
            <p className="small" style={{ marginTop: "0.8rem" }}>
              Made for <strong>{verdict.audience}</strong>, valid until {new Date(verdict.expires!).toUTCString()}. If that isn't you, don't rely on it.
            </p>
          </>
        )}
      </div>

      {verdict.ok && (
        <div className="slip" style={{ marginBottom: "1.2rem" }}>
          <header>
            <div>
              <h2 className="h3" style={{ margin: 0 }}>What the employee chose to show</h2>
              <span className="small muted">Everything else on the payslip stays sealed. Amounts are in {fields.currency}.</span>
            </div>
          </header>
          <table>
            <tbody>
              <tr><td>Employee's account</td><td className="hash">{verdict.employee}</td></tr>
              <tr><td>Employer's account</td><td className="hash">{verdict.employer}</td></tr>
              <tr><td>Pay period</td><td>{verdict.period}</td></tr>
              {shown.map((n) => (
                <tr key={n}><td>{fieldName(n, fields.currency)}</td><td><strong>{fieldValue(n, fields[n]!, fields)}</strong></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 className="h3">What was checked</h2>
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
      {verdict.ok && bundle && <OnChainCheck bundle={bundle} employee={verdict.employee!} />}
      <button className="btn ghost" onClick={onReset}>Check another proof</button>
    </>
  );
}

/** Asks the CistaVerifier contract to check the same proof, with QoreChain's own PQC precompiles. */
function OnChainCheck({ bundle, employee }: { bundle: ProofBundle; employee: string }) {
  const [result, setResult] = useState<OnChainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await checkOnChain(bundle));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const same = result?.ok && result.employee.toLowerCase() === parseAddress(employee).hex.toLowerCase();
  return (
    <div className="card">
      <h2 className="h3">Check it on chain too</h2>
      <p className="small muted">
        The <a href={EXPLORER_ADDRESS + VERIFIER} target="_blank" rel="noreferrer">CistaVerifier contract</a> checks the same proof with QoreChain's own
        post-quantum precompiles: the employer's ML-DSA-87 signature, then every shown field. Any app or contract can ask it the same question.
      </p>
      {!result && (
        <button className="btn ghost" disabled={busy} onClick={run}>{busy ? "Asking the contract…" : "Check on chain"}</button>
      )}
      {error && <Notice kind="bad">{error}</Notice>}
      {result && (
        <ul className="checks">
          {result.ok ? (
            <li className={same ? "ok" : "bad"}>
              <span className="mark">{same ? "✓" : "✕"}</span>
              <div>
                {same
                  ? `CistaVerifier confirmed it: the employer ${result.employer} signed the pay run (ML-DSA-87, checked by the chain), and the shown fields are in the payslip of ${result.employee}.`
                  : `The contract confirmed a payslip of ${result.employee}, which is not the account this proof names.`}
              </div>
            </li>
          ) : (
            <li className="bad"><span className="mark">✕</span><div>The contract refused it: {result.reason}.</div></li>
          )}
        </ul>
      )}
    </div>
  );
}
