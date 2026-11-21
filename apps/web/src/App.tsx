import { short } from "./components";
import { signOut } from "./lib/api";
import { Link, usePath } from "./lib/router";
import { ThemeToggle } from "./ThemeToggle";
import { useSession } from "./lib/useSession";
import { Employer } from "./pages/Employer";
import { Home } from "./pages/Home";
import { Payslips } from "./pages/Payslips";
import { Setup } from "./pages/Setup";
import { Verify } from "./pages/Verify";

const PAGES: Record<string, () => React.ReactNode> = {
  "/": Home,
  "/employer": Employer,
  "/payslips": Payslips,
  "/setup": Setup,
  "/verify": Verify,
};

const NAV: [string, string][] = [
  ["/employer", "Run payroll"],
  ["/payslips", "My payslips"],
  ["/verify", "Check a proof"],
  ["/setup", "My key"],
];

export function App() {
  const path = usePath();
  const session = useSession();
  const Page = PAGES[path] ?? NotFound;
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#14213d" />
            <path d="M8 12h16v12a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" fill="none" stroke="#e9c46a" strokeWidth="2" />
            <path d="M7 9h18v3H7z" fill="#e9c46a" />
            <path d="M16 15v6" stroke="#e9c46a" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Cista
        </Link>
        <nav className="nav">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <span className="spacer" />
        <ThemeToggle />
        {session && (
          <span className="row small">
            <span className="mono" title={session.address}>{short(session.address)}</span>
            <button className="btn ghost small" onClick={() => void signOut()}>Sign out</button>
          </span>
        )}
      </header>
      <main className="page">
        <Page />
      </main>
      <footer className="footer">
        <span>Cista · QoreChain testnet only</span>
        <a href="https://github.com/phoenix-2203/cista" target="_blank" rel="noreferrer">Source</a>
        <a href="https://build.qorechain.io/p/cista" target="_blank" rel="noreferrer">Build Before Q-Day</a>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <div className="card">
      <h2>Page not found</h2>
      <Link href="/">Back to the start</Link>
    </div>
  );
}
