import { useEffect, useState, type ReactNode } from "react";
import { signIn } from "./lib/api";
import { hasQorex, QOREX_INSTALL_URL } from "./lib/qorex";
import { Link, navigate } from "./lib/router";
import { restoreKeys, savedVault, unlockedKeys } from "./lib/keys";
import { UnlockForm } from "./pages/KeyForms";
import { useSession } from "./lib/useSession";

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function short(address: string): string {
  return address.length > 20 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address;
}

/** Kobo (or any minor unit) to a grouped amount with 2 decimals. */
export function money(minor: bigint | string, currency = "NGN"): string {
  const v = typeof minor === "string" ? BigInt(minor) : minor;
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "NGN" ? "₦" : `${currency} `;
  return `${sign}${symbol}${whole}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** uqor to QOR, trimmed. */
export function qor(uqor: bigint | string): string {
  const v = typeof uqor === "string" ? BigInt(uqor) : uqor;
  const whole = (v / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} QOR`;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "ok" | "bad"; children: ReactNode }) {
  return <div className={`notice ${kind === "info" ? "" : kind}`} role={kind === "bad" ? "alert" : "status"}>{children}</div>;
}

/** Runs an async action with a busy flag and an error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function SignInCard({ why }: { why: string }) {
  const { busy, error, run } = useAction();
  if (!hasQorex()) {
    return (
      <div className="card">
        <h3>QoreX is needed here</h3>
        <p>{why} Cista signs with QoreX, QoreChain's wallet, so your post-quantum key never leaves it.</p>
        <a className="btn" href={QOREX_INSTALL_URL} target="_blank" rel="noreferrer">Get QoreX for Chrome</a>
        <p className="small muted" style={{ marginTop: "0.8rem" }}>Already installed? Unlock it and reload this page.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Sign in with QoreX</h3>
      <p>{why} QoreX will ask you to sign a short sign-in text. It sends nothing and costs nothing.</p>
      {error && <Notice kind="bad">{error}</Notice>}
      <button className="btn" disabled={busy} onClick={() => run(signIn)}>{busy ? "Waiting for QoreX…" : "Sign in with QoreX"}</button>
    </div>
  );
}

/** Shows children only when signed in and the sealing key is unlocked; unlocks in place. */
export function NeedsKey({ why, children }: { why: string; children: (address: string) => ReactNode }) {
  const session = useSession();
  const [checked, setChecked] = useState<string | null>(null);
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!session) return;
    let live = true;
    void restoreKeys(session.address).finally(() => live && setChecked(session.address));
    const on = () => rerender((n) => n + 1);
    window.addEventListener("cista:keys", on);
    return () => {
      live = false;
      window.removeEventListener("cista:keys", on);
    };
  }, [session?.address]);

  if (!session) return <SignInCard why={why} />;
  if (unlockedKeys(session.address)) return <>{children(session.address)}</>;
  if (checked !== session.address) return <div className="card">Opening your key…</div>;
  if (!savedVault(session.address)) {
    return (
      <div className="card">
        <h3>Set up your Cista key first</h3>
        <p>Payslips are sealed to a key that lives in this browser. It takes a minute, once.</p>
        <Link className="btn" href="/setup">Set up my key</Link>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Unlock your Cista key</h3>
      <UnlockForm address={session.address} onDone={() => rerender((n) => n + 1)} onForgot={() => navigate("/setup?forgot=1")} />
    </div>
  );
}
