/** After the key is unlocked: publish the key card, signed in QoreX. */
import { useEffect, useState } from "react";
import type { SealKeyPair } from "@qorechain/qoreseal";
import { Notice, useAction } from "../components";
import { cardPublished, publishCard } from "../lib/keys";
import { Link } from "../lib/router";

export function NeedsKeyStatus({ address, keys }: { address: string; keys: SealKeyPair }) {
  const [published, setPublished] = useState<boolean | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    void run(async () => setPublished(await cardPublished(address, keys)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (published === null) return <div className="card">{error ? <Notice kind="bad">{error}</Notice> : "Checking your key card…"}</div>;

  return (
    <div className="card">
      <ul className="checks">
        <li className="ok"><span className="mark">✓</span><div><strong>Key unlocked in this browser</strong></div></li>
        <li className={published ? "ok" : "wait"}>
          <span className="mark">{published ? "✓" : "2"}</span>
          <div>
            <strong>Key card published</strong>
            <p className="small muted">
              A short text you sign in QoreX with your post-quantum (ML-DSA-87) key. It names your ML-KEM-1024 and X25519 public keys, so an
              employer can check they're really yours before sealing a payslip to them. Free: nothing is sent to the chain.
            </p>
            {!published && (
              <button className="btn small" disabled={busy} onClick={() => run(async () => { await publishCard(address, keys); setPublished(true); })}>
                {busy ? "Waiting for QoreX…" : "Sign and publish"}
              </button>
            )}
          </div>
        </li>
      </ul>
      {error && <Notice kind="bad">{error}</Notice>}
      {published && (
        <>
          <Notice kind="ok">You're set up. Employers can now seal payslips to {address}.</Notice>
          <div className="row">
            <Link className="btn" href="/payslips">My payslips</Link>
            <Link className="btn ghost" href="/employer">Run payroll</Link>
          </div>
        </>
      )}
    </div>
  );
}
