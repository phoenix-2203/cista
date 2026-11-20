/**
 * Make a proof of pay, in three steps: what to prove (a standard proof type,
 * or a custom pick), who it's for and until when, then a preview of exactly
 * what they will see before signing in QoreX.
 */
import { useMemo, useState } from "react";
import { createDisclosure, encodeProofBundle, proofStatement, type ProofBundle } from "@phoenix-2203/cista";
import { money, Notice, useAction } from "../components";
import { ALWAYS, bands, claims, fieldName, fieldValue, GROUPS, presetFields, PROOF_KINDS, PURPOSES, type ProofKind } from "../lib/fields";
import { signText } from "../lib/qorex";
import type { InboxEntry } from "./Payslips";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function ProofMaker({ address, entry }: { address: string; entry: InboxEntry }) {
  const slip = entry.opened!.slip;
  const values = useMemo(() => Object.fromEntries(slip.fields.map((f) => [f.name, f.value])), [slip]);
  const ladder = useMemo(() => bands(values), [values]);
  const yes = ladder.filter((b) => b.yes);
  const no = ladder.filter((b) => !b.yes);
  const currency = values.currency ?? "USD";

  const [kind, setKind] = useState<ProofKind>(yes.length ? "above" : "employment");
  const [above, setAbove] = useState(yes.at(-1)?.name ?? "");
  const [from, setFrom] = useState(yes.at(-1)?.name ?? "");
  const [to, setTo] = useState(no[0]?.name ?? "");
  const [custom, setCustom] = useState<Set<string>>(new Set());
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>("Loan");
  const [who, setWho] = useState("");
  const [expires, setExpires] = useState(inDays(30));
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();

  const picked = useMemo(
    () => (kind === "custom" ? [...custom] : presetFields(kind, values, { above, from, to })),
    [kind, custom, values, above, from, to],
  );
  const shown = useMemo(() => {
    const f: Record<string, string> = { "employee.address": address, currency };
    for (const n of picked) f[n] = values[n]!;
    return f;
  }, [picked, values, address, currency]);
  const sealedCount = slip.fields.filter((f) => !(f.name in shown) && f.name !== "version").length;

  if (!entry.payment) {
    return <div className="card"><h3>Prove your pay</h3><p className="muted">You can make a proof once this pay run's payment is on chain.</p></div>;
  }

  const reset = () => setLink(null);
  const choose = (k: ProofKind) => {
    if (k === "custom" && kind !== "custom") setCustom(new Set(picked));
    setKind(k);
    reset();
  };
  const toggle = (n: string) => {
    const next = new Set(custom);
    next.has(n) ? next.delete(n) : next.add(n);
    setCustom(next);
    reset();
  };

  const audience = `${purpose}: ${who.trim()}`;
  const make = () =>
    run(async () => {
      if (!who.trim()) throw new Error("say who the proof is for, e.g. the bank and your application number");
      if (kind === "range" && (!from || !to)) throw new Error("pick both ends of the range");
      const disclosure = createDisclosure(entry.opened!.run, slip, picked);
      const terms = { audience, expires: new Date(`${expires}T23:59:59Z`).toISOString() };
      const signature = await signText(address, proofStatement(disclosure, terms));
      const bundle: ProofBundle = { v: 1, proof: { disclosure, terms, signature }, run: entry.run, paymentTx: entry.payment!.txHash };
      setLink(`${location.origin}/verify#${encodeProofBundle(bundle)}`);
      setCopied(false);
    });

  return (
    <div className="card">
      <h3>Prove your pay</h3>
      <p className="muted">Share one fact from this payslip, not the payslip. The person checking needs no wallet, sees only what you choose, and can check it against the chain.</p>

      <h4 className="step-title">1 · What do you need to prove?</h4>
      <div className="choice-grid" role="radiogroup">
        {PROOF_KINDS.map((k) => {
          const disabled = (k.kind === "above" && yes.length === 0) || (k.kind === "range" && (yes.length === 0 || no.length === 0));
          return (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} disabled={disabled} className={`choice ${kind === k.kind ? "on" : ""}`} onClick={() => choose(k.kind)}>
              <strong>{k.title}</strong>
              <span>{k.blurb}</span>
            </button>
          );
        })}
      </div>

      {kind === "above" && (
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor="above">Net pay is at least</label>
          <select id="above" value={above} onChange={(e) => { setAbove(e.target.value); reset(); }}>
            {[...yes].reverse().map((b) => <option key={b.name} value={b.name}>{money(b.amount, currency)} a month</option>)}
          </select>
        </div>
      )}
      {kind === "range" && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="from">At least</label>
            <select id="from" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }}>
              {[...yes].reverse().map((b) => <option key={b.name} value={b.name}>{money(b.amount, currency)}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="to">Less than</label>
            <select id="to" value={to} onChange={(e) => { setTo(e.target.value); reset(); }}>
              {no.map((b) => <option key={b.name} value={b.name}>{money(b.amount, currency)}</option>)}
            </select>
          </div>
        </div>
      )}
      {kind === "custom" && (
        <div className="stack" style={{ marginBottom: "1rem" }}>
          {GROUPS.map((g) => {
            const names = slip.fields.map((f) => f.name).filter((n) => !ALWAYS.has(n) && g.test(n));
            if (names.length === 0) return null;
            return (
              <fieldset key={g.title} className="group">
                <legend>{g.title}</legend>
                {names.map((n) => (
                  <label key={n} className="tick">
                    <input type="checkbox" checked={custom.has(n)} onChange={() => toggle(n)} />
                    <span>{fieldName(n, currency)} <span className="muted small">· {fieldValue(n, values[n] ?? "", values)}</span></span>
                  </label>
                ))}
              </fieldset>
            );
          })}
          <p className="small muted">For a pay band or range, use the "Income above" or "Income in a range" proof types.</p>
        </div>
      )}

      <h4 className="step-title">2 · Who is it for?</h4>
      <div className="grid">
        <div className="field">
          <label htmlFor="purpose">Purpose</label>
          <select id="purpose" value={purpose} onChange={(e) => { setPurpose(e.target.value as (typeof PURPOSES)[number]); reset(); }}>
            {PURPOSES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="who">Name and reference <span className="hint">named in what you sign</span></label>
          <input id="who" placeholder="Zenith Bank, application 4471" maxLength={100} value={who} onChange={(e) => { setWho(e.target.value); reset(); }} />
        </div>
        <div className="field">
          <label htmlFor="exp">Valid until</label>
          <select id="exp-quick" aria-label="validity" value="" onChange={(e) => { if (e.target.value) { setExpires(inDays(Number(e.target.value))); reset(); } }} style={{ marginBottom: "0.4rem" }}>
            <option value="">Quick pick…</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
          <input id="exp" type="date" min={inDays(1)} value={expires} onChange={(e) => { setExpires(e.target.value); reset(); }} />
        </div>
      </div>

      <h4 className="step-title">3 · What they will see</h4>
      <div className="preview">
        <ul>
          {claims(shown).map((c) => <li key={c}>{c}</li>)}
          {claims(shown).length === 0 && <li className="muted">Pick something to prove above.</li>}
        </ul>
        <p className="small muted">
          Plus your account address and that amounts are in {currency}. For "{audience}", until {expires}. {sealedCount} other lines of this payslip stay sealed.
        </p>
      </div>

      {error && <Notice kind="bad">{error}</Notice>}
      {!link ? (
        <button className="btn seal" disabled={busy || picked.length === 0} onClick={make}>{busy ? "Waiting for QoreX…" : "Sign the proof in QoreX"}</button>
      ) : (
        <div className="stack">
          <Notice kind="ok">Proof signed. Send this link; anyone can check it, with no wallet, until {expires}.</Notice>
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
