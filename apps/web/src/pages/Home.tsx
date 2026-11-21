import deployment from "@cista/contracts/deployments/testnet.json";
import { short } from "../components";
import {
  IconArrow, IconArrowUp, IconAtom, IconBank, IconBriefcase, IconBuilding, IconChain, IconEyeOff,
  IconKey, IconPay, IconPerson, IconProve, IconRange, IconReceipt, IconSeal, IconSign, IconSliders,
} from "../icons";
import { EXPLORER_TX } from "../lib/chain";
import { PURPOSES } from "../lib/fields";
import { EXPLORER_ADDRESS, VERIFIER } from "../lib/onchain";
import { Link } from "../lib/router";
import { useRef } from "react";
import { useReveal } from "../lib/reveal";
import { Seal } from "../Logo";

/** The fUSD pay run listed under "Proven on testnet" in the README. */
const FUSD_RUN_TX = "A3978B6A03093FCBF862B3EC8538DFC4E799A7387E74F66C4140B769C6780DA5";
const FUSD_RUN_ROOT = deployment.checkedAgainstRun;
const REPO = "https://github.com/phoenix-2203/cista";

export function Home() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <div className="landing" ref={root}>
      <section className="hero">
        <div>
          <p className="badge"><i />Live on QoreChain testnet · Encrypted Apps</p>
          <h1>Everyone gets paid. Only you can <em>read</em> your payslip.</h1>
          <p className="lede">
            Cista runs payroll on QoreChain. Payslips are sealed with ML-KEM-1024 before they leave the employer's browser, one hybrid-signed
            transaction pays the whole team in fUSD, and anyone can prove their pay to a lender without handing over the payslip.
          </p>
          <div className="row">
            <Link className="btn" href="/employer">Run payroll <IconArrow /></Link>
            <Link className="btn ghost" href="/payslips">My payslips</Link>
            <Link className="btn ghost" href="/verify">Check a proof</Link>
          </div>
          <p className="ticks"><span>✓ ML-KEM-1024 sealed</span><span>✓ ML-DSA-87 signed</span><span>✓ Checked on chain</span></p>
        </div>
        <div className="hero-art">
          <div className="glow" aria-hidden="true" />
          <SealedSlip />
        </div>
      </section>

      <section className="facts" aria-label="Proven on testnet">
        <a href={EXPLORER_ADDRESS + VERIFIER} target="_blank" rel="noreferrer"><b className="addr">{short(VERIFIER)}</b>CistaVerifier contract</a>
        <span><b>{deployment.verifyRunGas.toLocaleString("en-US")}</b>gas to check a pay run on chain</span>
        <a href={`${REPO}/blob/main/docs/qday-drill.md`} target="_blank" rel="noreferrer"><b>8 / 8</b>Q-Day attacks refused</a>
        <a href={EXPLORER_TX + FUSD_RUN_TX} target="_blank" rel="noreferrer"><b>#10,502,279</b>block of a real fUSD pay run</a>
      </section>

      <Problem />
      <TwoViews />
      <Audiences />
      <Steps />
      <Proofs />
      <QDay />
      <Compare />
      <Faq />
      <Closing />
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow"><Seal size={12} />{children}</p>;
}

function Problem() {
  return (
    <section className="block">
      <Eyebrow>The problem</Eyebrow>
      <h2 className="statement">
        On a public chain, payroll is a public <em>record.</em> <span>On paper, it's a PDF anyone can fake. Neither is fit for a salary.</span>
      </h2>
      <div className="split">
        <div className="panel">
          <h3>Payroll paid on a public chain</h3>
          <ul className="xlist">
            <li>Every salary is a permanent, searchable transfer.</li>
            <li>Anyone with an explorer can rank a team by pay.</li>
            <li>Signed with classical keys a quantum computer will break.</li>
          </ul>
        </div>
        <div className="panel">
          <h3>Payslips as PDFs</h3>
          <ul className="xlist">
            <li>Private, but trivial to edit and impossible to check.</li>
            <li>Proving your income means handing over every line.</li>
            <li>The lender keeps a copy of all of it, forever.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/** What the chain stores for a real run, next to what only the employee can open. */
function TwoViews() {
  const chain: [string, React.ReactNode][] = [
    ["Message", "MsgMultiSend"],
    ["Total", "10 fUSD"],
    ["Memo", `cista:v1:${FUSD_RUN_ROOT.slice(0, 8)}…${FUSD_RUN_ROOT.slice(-4)}`],
    ["Signatures", "secp256k1 + ML-DSA-87"],
    ["Block", "10,502,279"],
  ];
  const slip: [string, string][] = [
    ["Employer", "Acme Labs"],
    ["Role", "Data analyst"],
    ["Gross pay", "$3,450.50"],
    ["Tax", "$520.00"],
    ["Pension", "$140.00"],
    ["Net pay", "$2,790.50"],
  ];
  return (
    <section className="block">
      <Eyebrow>Two views of one pay run</Eyebrow>
      <h2>The chain gets the payment. <em>Only the employee</em> gets the payslip.</h2>
      <p className="sub">The transfer and a fingerprint of the run are public, like any payment. Every line of the payslip is sealed to one person's key.</p>
      <div className="views">
        <figure className="view">
          <header><IconChain size={18} /><span>What the chain sees</span><a href={EXPLORER_TX + FUSD_RUN_TX} target="_blank" rel="noreferrer">Real tx ↗</a></header>
          {chain.map(([k, v]) => (<div className="kv" key={k}><span>{k}</span><span className="mono">{v}</span></div>))}
          <div className="kv sealed"><span>Payslip lines</span><span className="mono">not on chain</span></div>
        </figure>
        <div className="bridge" aria-hidden="true"><Seal size={44} /></div>
        <figure className="view open">
          <header><IconEyeOff size={18} /><span>What only the employee opens</span><em>Example</em></header>
          {slip.map(([k, v]) => (<div className="kv" key={k}><span>{k}</span><span className="mono">{v}</span></div>))}
        </figure>
      </div>
    </section>
  );
}

function Audiences() {
  const who = [
    { icon: <IconBuilding />, title: "Employers", href: "/employer", cta: "Run payroll",
      points: ["Seal every payslip in your browser", "Sign the run once in QoreX", "Pay the whole team in one transaction"] },
    { icon: <IconPerson />, title: "Employees", href: "/payslips", cta: "Open my payslips",
      points: ["Only your key opens your payslip", "Recover it with a 24-word phrase", "Prove one fact, keep the rest sealed"] },
    { icon: <IconBank />, title: "Lenders and landlords", href: "/verify", cta: "Check a proof",
      points: ["Paste a proof link, no wallet needed", "Checked against the chain, not a PDF", "See only what you were shown"] },
  ];
  return (
    <section className="block">
      <Eyebrow>Who it's for</Eyebrow>
      <h2>One pay run, three people who need different things.</h2>
      <div className="cards3">
        {who.map((w) => (
          <article className="tile" key={w.title}>
            <span className="icon-tile">{w.icon}</span>
            <h3>{w.title}</h3>
            <ul className="ticklist">{w.points.map((p) => <li key={p}>{p}</li>)}</ul>
            <Link className="more" href={w.href}>{w.cta} <IconArrow size={14} /></Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function Steps() {
  const steps = [
    { icon: <IconSeal />, title: "Seal", text: "Each payslip is sealed to its employee's key with ML-KEM-1024 and X25519, in the employer's browser.", meta: "Server stores ciphertext only" },
    { icon: <IconSign />, title: "Sign", text: "The employer signs the run's fingerprint once in QoreX with ML-DSA-87.", meta: "cista:v1:<run root>" },
    { icon: <IconPay />, title: "Pay", text: "One hybrid-signed MsgMultiSend pays everyone in fUSD and carries the fingerprint in its memo.", meta: "1 transaction · whole team" },
    { icon: <IconProve />, title: "Prove", text: "The employee opens the payslip and shares one fact, signed for one verifier, until a date.", meta: "Checked here or on chain" },
  ];
  return (
    <section className="block">
      <Eyebrow>How it works</Eyebrow>
      <h2>Seal, sign, pay, <em>prove.</em></h2>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <div className="step-top"><span className="icon-tile">{s.icon}</span><span className="step-n mono">0{i + 1}</span></div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <p className="meta mono">{s.meta}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Proofs() {
  const kinds = [
    { icon: <IconBriefcase />, title: "Employment", text: "Who employs you, your role and since when. No pay." },
    { icon: <IconArrowUp />, title: "Income above", text: "Net pay is at least an amount you pick. The figure stays sealed." },
    { icon: <IconRange />, title: "Income in a range", text: "Net pay is between two amounts. The figure stays sealed." },
    { icon: <IconReceipt />, title: "Exact pay", text: "Net and gross pay, and the payment that reached your account." },
    { icon: <IconSliders />, title: "Custom", text: "Pick exactly which lines of the payslip to show." },
  ];
  return (
    <section className="block">
      <Eyebrow>Proof of pay</Eyebrow>
      <div className="split head">
        <h2>Show the fact. <em>Keep the payslip.</em></h2>
        <p className="sub">Every proof is signed by the employer's run and by the employee, made for one verifier, and expires. Nothing else on the payslip is revealed.</p>
      </div>
      <div className="proof-grid">
        {kinds.map((k) => (
          <article className="tile small" key={k.title}>
            <span className="icon-tile">{k.icon}</span>
            <h3>{k.title}</h3>
            <p>{k.text}</p>
          </article>
        ))}
        <article className="tile small purposes">
          <h3>Made for</h3>
          <div className="chips">{PURPOSES.map((p) => <span className="chip" key={p}>{p}</span>)}</div>
        </article>
      </div>
    </section>
  );
}

function QDay() {
  return (
    <section className="qday">
      <div className="qday-glow" aria-hidden="true" />
      <Eyebrow>Why post-quantum</Eyebrow>
      <h2>A payslip sealed today must stay sealed <em>after Q-Day.</em></h2>
      <p className="sub">Encrypted data can be stored now and broken later. A salary history is worth that wait, so Cista uses NIST's post-quantum standards for every step that matters.</p>
      <div className="qcols">
        <div><span className="icon-tile"><IconSeal /></span><h3>ML-KEM-1024 + X25519</h3><p>Seals each payslip. Both would have to break to open it.</p></div>
        <div><span className="icon-tile"><IconKey /></span><h3>ML-DSA-87</h3><p>Signs the pay run, the payment, sign-in and every proof, next to secp256k1.</p></div>
        <div><span className="icon-tile"><IconAtom /></span><h3>Checked on chain</h3><p>CistaVerifier calls QoreChain's PQC precompiles to verify a run's signature.</p></div>
      </div>
      <a className="drill" href={`${REPO}/blob/main/docs/qday-drill.md`} target="_blank" rel="noreferrer">
        <b>8 / 8</b>
        <span>An attacker holding only a stolen classical key tried eight attacks on the live testnet. All eight were refused.</span>
        <IconArrow />
      </a>
    </section>
  );
}

function Compare() {
  const Y = <span className="yes" aria-label="Yes">✓</span>;
  const N = <span className="no" aria-label="No">✕</span>;
  const rows: [string, React.ReactNode, React.ReactNode, React.ReactNode][] = [
    ["Pay settles on chain", Y, N, Y],
    ["Payslip lines stay private", N, Y, Y],
    ["Payslip can't be edited or faked", N, N, Y],
    ["Prove one fact, not the whole payslip", N, N, Y],
    ["Verifier needs no wallet or account", "—", Y, Y],
    ["Sealed and signed post-quantum", N, N, Y],
  ];
  return (
    <section className="block">
      <Eyebrow>How it compares</Eyebrow>
      <h2>The privacy of paper, the proof of a chain.</h2>
      <div className="table-wrap compare">
        <table>
          <thead><tr><th /><th>Payroll on a public chain</th><th>PDF payslips</th><th className="us">Cista</th></tr></thead>
          <tbody>{rows.map(([k, a, b, c]) => (<tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td><td className="us">{c}</td></tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}

function Faq() {
  const qa: [string, string][] = [
    ["Can Cista read my payslip?", "No. Payslips are sealed in the employer's browser to the employee's key. Cista's server stores ciphertext and can't open it."],
    ["What is public on chain?", "The payment: who was paid, how much, and the run's fingerprint in the memo. Names, roles, gross pay, tax and deductions are not on chain."],
    ["What if I forget my password?", "Your key comes from a 24-word recovery phrase shown once when you make it. The phrase rebuilds the same key and every payslip opens again."],
    ["Does a lender need a wallet?", "No. They open the proof link on the Check a proof page. Anyone can also ask CistaVerifier on chain to check the run's signature."],
    ["Which tokens does it pay in?", "fUSD, QoreChain's native stablecoin, at $1 per fUSD. The first test run paid in QOR."],
    ["Is this live on mainnet?", "Not yet. Cista runs on QoreChain's testnet; every transaction linked on this page is real and on that testnet."],
  ];
  return (
    <section className="block faq-block">
      <div>
        <Eyebrow>Questions</Eyebrow>
        <h2>Answered <em>plainly.</em></h2>
        <p className="sub">More in the <a href={REPO} target="_blank" rel="noreferrer">README</a> and the <a href={`${REPO}/blob/main/audit.md`} target="_blank" rel="noreferrer">security audit</a>.</p>
      </div>
      <div className="faq">
        {qa.map(([q, a]) => (
          <details key={q}><summary>{q}</summary><p>{a}</p></details>
        ))}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="closing">
      <Seal size={56} />
      <h2>Run your first <em>sealed</em> pay run.</h2>
      <p className="sub">Make a key, add your team, sign once in QoreX. It takes a few minutes on testnet.</p>
      <div className="row center">
        <Link className="btn" href="/employer">Run payroll <IconArrow /></Link>
        <Link className="btn ghost" href="/setup">Make my key</Link>
      </div>
    </section>
  );
}

/** An example payslip: every line sealed except the one fact being proven. */
function SealedSlip() {
  const rows: [string, number][] = [["Gross pay", 92], ["Tax", 70], ["Pension", 58], ["Net pay", 84]];
  return (
    <figure className="sealed-slip" aria-label="An example payslip with every line sealed except one proven fact">
      <header><span>Example payslip · Nov 2026</span><span>fUSD</span></header>
      <div className="line"><span>Employee</span><span className="mono">qor1qef7…8lwh</span></div>
      {rows.map(([k, w]) => (
        <div className="line" key={k}><span>{k}</span><span className="redacted" style={{ width: w }} /></div>
      ))}
      <div className="proven">
        <Seal size={28} />
        <div><strong>Net pay at least $2,500</strong><small>Proven · every other line stays sealed</small></div>
        <span className="tag">Verified</span>
      </div>
    </figure>
  );
}
