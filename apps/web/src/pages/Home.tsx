import { Link } from "../lib/router";

export function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="pill seal" style={{ marginBottom: "1rem" }}>QoreChain testnet · Encrypted Apps</p>
          <h1>Everyone gets paid. Only you see your payslip.</h1>
          <p className="lede">
            Cista runs payroll on QoreChain. Payslips are sealed with ML-KEM-1024 before they leave the employer's browser, one hybrid-signed
            transaction pays the whole team in fUSD, and anyone can prove their pay to a lender without handing over the payslip.
          </p>
          <div className="row">
            <Link className="btn" href="/employer">Run payroll</Link>
            <Link className="btn ghost" href="/payslips">My payslips</Link>
            <Link className="btn ghost" href="/verify">Check a proof of pay</Link>
          </div>
        </div>
        <SlipArt />
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

function SlipArt() {
  return (
    <svg viewBox="0 0 360 300" role="img" aria-label="A sealed payslip" style={{ width: "100%", maxWidth: 420, justifySelf: "center" }}>
      <rect x="40" y="20" width="250" height="250" rx="10" fill="#fff" stroke="#ddd4c0" />
      <rect x="60" y="44" width="120" height="12" rx="3" fill="#14213d" />
      <rect x="60" y="64" width="80" height="8" rx="3" fill="#ddd4c0" />
      <line x1="60" y1="88" x2="270" y2="88" stroke="#14213d" strokeWidth="2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x="60" y={106 + i * 24} width={90 + (i % 3) * 20} height="8" rx="3" fill="#efe9db" />
          <rect x="210" y={106 + i * 24} width="60" height="8" rx="3" fill="#efe9db" />
        </g>
      ))}
      <rect x="60" y="232" width="210" height="16" rx="4" fill="#f3e3b8" />
      <circle cx="275" cy="225" r="46" fill="#b8892b" opacity="0.95" />
      <circle cx="275" cy="225" r="38" fill="none" stroke="#f3e3b8" strokeDasharray="3 4" />
      <path d="M262 222v-6a13 13 0 0 1 26 0v6" fill="none" stroke="#fff" strokeWidth="4" />
      <rect x="257" y="221" width="36" height="26" rx="4" fill="#fff" />
      <circle cx="275" cy="233" r="4" fill="#b8892b" />
    </svg>
  );
}
