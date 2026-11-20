/** The two on-chain steps after the key is unlocked: register it, publish the card. */
import { useEffect, useState } from "react";
import type { SealKeyPair } from "@qorechain/qoreseal";
import { Notice, useAction } from "../components";
import { EXPLORER_TX, waitForTx } from "../lib/chain";
import { keyStatus, publishCard, registerKemKey, type KeyStatus } from "../lib/keys";
import { Link } from "../lib/router";

export function NeedsKeyStatus({ address, keys }: { address: string; keys: SealKeyPair }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const refresh = () => run(async () => setStatus(await keyStatus(address, keys)));

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!status) return <div className="card">{error ? <Notice kind="bad">{error}</Notice> : "Checking your key on chain…"}</div>;

  const done = status.registered && status.cardPublished;
  return (
    <div className="card">
      <ul className="checks">
        <li className="ok"><span className="mark">✓</span><div><strong>Key unlocked in this browser</strong></div></li>
        <li className={status.registered ? "ok" : "wait"}>
          <span className="mark">{status.registered ? "✓" : "2"}</span>
          <div>
            <strong>ML-KEM-1024 key registered on chain</strong>
            <p className="small muted">
              So employers can seal payslips to you. QoreX signs it with your post-quantum key; it costs a little test QOR.
              {status.otherKeyOnChain && " A different key is registered now; this replaces it."}
            </p>
            {!status.registered && (
              <button
                className="btn small"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await registerKemKey(address, keys);
                    setTx(r.txHash);
                    await waitForTx(r.txHash);
                    setStatus(await keyStatus(address, keys));
                  })
                }
              >
                {busy ? "Waiting…" : "Register in QoreX"}
              </button>
            )}
            {tx && <p className="small"><a href={EXPLORER_TX + tx} target="_blank" rel="noreferrer">View the transaction</a></p>}
          </div>
        </li>
        <li className={status.cardPublished ? "ok" : "wait"}>
          <span className="mark">{status.cardPublished ? "✓" : "3"}</span>
          <div>
            <strong>Recipient card published</strong>
            <p className="small muted">A short text you sign in QoreX that adds an X25519 key, so payslips are sealed with ML-KEM-1024 and X25519 together.</p>
            {!status.cardPublished && (
              <button
                className="btn small"
                disabled={busy || !status.registered}
                onClick={() =>
                  run(async () => {
                    await publishCard(address, keys);
                    setStatus(await keyStatus(address, keys));
                  })
                }
              >
                Sign and publish
              </button>
            )}
          </div>
        </li>
      </ul>
      {error && <Notice kind="bad">{error}</Notice>}
      {done && (
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
