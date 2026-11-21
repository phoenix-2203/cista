import deployment from "@cista/contracts/deployments/testnet.json";
import { short } from "../components";
import { EXPLORER_TX } from "../lib/chain";
import { EXPLORER_ADDRESS, VERIFIER } from "../lib/onchain";
import { Link } from "../lib/router";
import { Seal } from "../Logo";

/** The fUSD pay run listed under "Proven on testnet" in the README. */
const FUSD_RUN_TX = "A3978B6A03093FCBF862B3EC8538DFC4E799A7387E74F66C4140B769C6780DA5";


export function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="badge"><i />Live on QoreChain testnet · Encrypted Apps</p>
          <h1>Everyone gets paid. Only you can <em>read</em> your payslip.</h1>
          <p className="lede">
            Cista runs payroll on QoreChain. Payslips are sealed with ML-KEM-1024 before they leave the employer's browser, one hybrid-signed
            transaction pays the whole team in fUSD, and anyone can prove their pay to a lender without handing over the payslip.
          </p>
          <div className="row">
            <Link className="btn" href="/employer">Run payroll →</Link>
            <Link className="btn ghost" href="/payslips">My payslips</Link>
            <Link className="btn ghost" href="/verify">Check a proof</Link>
          </div>
          <p className="ticks"><span>✓ ML-KEM-1024 sealed</span><span>✓ ML-DSA-87 signed</span><span>✓ Checked on chain</span></p>
        </div>
        <SealedSlip />
      </section>

      <section className="facts" aria-label="Proven on testnet">
        <a href={EXPLORER_ADDRESS + VERIFIER} target="_blank" rel="noreferrer"><b className="addr">{short(VERIFIER)}</b>CistaVerifier contract</a>
        <span><b>{deployment.verifyRunGas.toLocaleString("en-US")}</b>gas to check a pay run on chain</span>
        <a href="https://github.com/phoenix-2203/cista/blob/main/docs/qday-drill.md" target="_blank" rel="noreferrer"><b>8 / 8</b>Q-Day attacks refused</a>
        <a href={EXPLORER_TX + FUSD_RUN_TX} target="_blank" rel="noreferrer"><b>#10,502,279</b>block of a real fUSD pay run</a>
      </section>

      <section className="grid" style={{ marginBottom: "2rem" }}>
        <div className="card">
          <h3>1 · Sealed before it leaves</h3>
          <p>Each payslip is sealed to its employee's key (ML-KEM-1024 with X25519) in the employer's browser. Cista's server holds ciphertext only: a stolen copy stays unreadable, even to a future quantum computer.</p>
        </div>
        <div className="card">
          <h3>2 · Signed once, paid once</h3>
          <p>The employer signs the pay run's fingerprint in QoreX with ML-DSA-87. One transaction pays everyone and carries that fingerprint, so the payslips and the payment can't drift apart.</p>
        </div>
        <div className="card">
          <h3>3 · Prove one fact</h3>
          <p>"Net pay is at least $2,500", "employed since 2025", "paid by Acme". The employee shows only that, signed for one lender, until a date. The lender checks it here with no wallet.</p>
        </div>
      </section>

      <section className="card">
        <h3>What stays sealed, what stays public</h3>
        <div className="grid">
          <div>
            <p><strong>Sealed:</strong> names, roles, staff IDs, gross pay, tax, pension, deductions, and every line of the payslip.</p>
          </div>
          <div>
            <p><strong>Public, like any transfer:</strong> the payout amounts and addresses, and that an address received a payslip in a period.</p>
          </div>
        </div>
        <p className="small muted">A thief with only an account's classical key can't sign in, can't sign a pay run, can't forge a proof and can't send the payment: every one needs the account's ML-DSA-87 key.</p>
      </section>
    </>
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
