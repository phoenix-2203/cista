/** Make a proof of pay: pick fields, name the recipient, sign in QoreX, share a link. */
import { useMemo, useState } from "react";
import { createDisclosure, encodeProofBundle, proofStatement, type ProofBundle } from "@phoenix-2203/cista";
import { Notice, useAction } from "../components";
import { fieldName, fieldValue, pickable } from "../lib/fields";
import { signText } from "../lib/qorex";
import type { InboxEntry } from "./Payslips";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function ProofMaker({ address, entry }: { address: string; entry: InboxEntry }) {
  const slip = entry.opened!.slip;
  const names = useMemo(() => pickable(slip.fields.map((f) => f.name)), [slip]);
  const values = useMemo(() => Object.fromEntries(slip.fields.map((f) => [f.name, f.value])), [slip]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(["employer.name", "period", names.find((n) => n.startsWith("net.atLeast.") && values[n] === "yes") ?? "net"]));
  const [audience, setAudience] = useState("");
  const [expires, setExpires] = useState(inDays(30));
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();

  if (!entry.payment) {
    return <div className="card"><h3>Prove your pay</h3><p className="muted">You can make a proof once this pay run's payment is on chain.</p></div>;
  }

  const toggle = (n: string) => {
    const next = new Set(picked);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setPicked(next);
    setLink(null);
  };

  const make = () =>
    run(async () => {
      if (!audience.trim()) throw new Error("say who the proof is for, e.g. the lender and your application number");
      const disclosure = createDisclosure(entry.opened!.run, slip, [...picked]);
      const terms = { audience: audience.trim(), expires: new Date(`${expires}T23:59:59Z`).toISOString() };
      const signature = await signText(address, proofStatement(disclosure, terms));
      const bundle: ProofBundle = { v: 1, proof: { disclosure, terms, signature }, run: entry.run, paymentTx: entry.payment!.txHash };
      setLink(`${location.origin}/verify#${encodeProofBundle(bundle)}`);
      setCopied(false);
    });

  return (
    <div className="card">
      <h3>Prove your pay</h3>
      <p className="muted">Pick what to show. Everything else stays sealed: the person checking sees only the fields you tick, plus your account address.</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginBottom: "1rem" }}>
        {names.map((n) => (
          <label key={n} style={{ fontWeight: 400, display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={picked.has(n)} onChange={() => toggle(n)} />
            <span>
              {fieldName(n)} <span className="muted small">· {fieldValue(n, values[n] ?? "", slip.slip.currency)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="grid">
        <div className="field">
          <label htmlFor="aud">Who it's for <span className="hint">named in what you sign</span></label>
          <input id="aud" placeholder="Zenith Lending, application 4471" maxLength={120} value={audience} onChange={(e) => { setAudience(e.target.value); setLink(null); }} />
        </div>
        <div className="field">
          <label htmlFor="exp">Valid until</label>
          <input id="exp" type="date" min={inDays(1)} value={expires} onChange={(e) => { setExpires(e.target.value); setLink(null); }} />
        </div>
      </div>
      {error && <Notice kind="bad">{error}</Notice>}
      {!link ? (
        <button className="btn seal" disabled={busy || picked.size === 0} onClick={make}>{busy ? "Waiting for QoreX…" : "Sign the proof in QoreX"}</button>
      ) : (
        <div className="stack">
          <Notice kind="ok">Proof signed. Send this link; it can be checked by anyone, with no wallet, until {expires}.</Notice>
          <textarea readOnly value={link} onFocus={(e) => e.target.select()} />
          <div className="row">
            <button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? "Copied" : "Copy link"}</button>
            <a className="btn ghost" href={link} target="_blank" rel="noreferrer">Check it yourself</a>
          </div>
        </div>
      )}
    </div>
  );
}
