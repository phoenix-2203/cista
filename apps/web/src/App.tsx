import { short } from "./components";
import { signOut } from "./lib/api";
import { Link, usePath } from "./lib/router";
import { Wordmark } from "./Logo";
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
          <Wordmark height={34} />
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
        <div className="about">
          <Wordmark height={30} />
          <p>Sealed payroll on QoreChain. Everyone gets paid; only you can read your payslip.</p>
        </div>
        <nav aria-label="App">
          <h4>App</h4>
          <ul>{NAV.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
        </nav>
        <nav aria-label="Project">
          <h4>Project</h4>
          <ul>
            <li><a href="https://github.com/phoenix-2203/cista" target="_blank" rel="noreferrer">Source</a></li>
            <li><a href="https://github.com/phoenix-2203/cista/blob/main/audit.md" target="_blank" rel="noreferrer">Security audit</a></li>
            <li><a href="https://github.com/phoenix-2203/cista/blob/main/docs/qday-drill.md" target="_blank" rel="noreferrer">Q-Day drill</a></li>
          </ul>
        </nav>
        <nav aria-label="Network">
          <h4>Network</h4>
          <ul>
            <li><a href="https://build.qorechain.io/p/cista" target="_blank" rel="noreferrer">Build Before Q-Day</a></li>
            <li><a href="https://explore.qore.network/" target="_blank" rel="noreferrer">QoreChain explorer</a></li>
          </ul>
        </nav>
        <div className="base"><span>QoreChain testnet only · not for real salaries yet</span><span>MIT licence</span></div>
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
