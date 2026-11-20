/**
 * One-time setup of the sealing key, for employees and employers alike:
 * 1. make the key here and lock it with a password (and download the backup),
 * 2. register its ML-KEM-1024 half on chain (QoreX signs, hybrid),
 * 3. sign and publish the recipient card with its X25519 half.
 */
import { useEffect, useState } from "react";
import type { Vault } from "@phoenix-2203/cista";
import { NeedsKeyStatus } from "./SetupStatus";
import { Notice, SignInCard, useAction } from "../components";
import { createKeys, downloadVault, savedVault, unlockKeys, unlockedKeys } from "../lib/keys";
import { useSession } from "../lib/useSession";

export function Setup() {
  const session = useSession();
  const [, rerender] = useState(0);
  if (!session) return <SignInCard why="Your Cista key belongs to your QoreChain account." />;
  const address = session.address;
  const keys = unlockedKeys(address);

  return (
    <>
      <h1>Your Cista key</h1>
      <p className="muted">
        Payslips are sealed to this key with ML-KEM-1024, so only you (and your employer, who made the payslip) can open them.
        It's made in this browser and never sent anywhere unlocked.
      </p>
      {keys ? <NeedsKeyStatus address={address} keys={keys} /> : <MakeOrUnlock address={address} onDone={() => rerender((n) => n + 1)} />}
    </>
  );
}

function MakeOrUnlock({ address, onDone }: { address: string; onDone: () => void }) {
  const [vault, setVault] = useState<Vault | null>(() => savedVault(address));
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [made, setMade] = useState<Vault | null>(null);
  const { busy, error, setError, run } = useAction();

  useEffect(() => setVault(savedVault(address)), [address]);

  if (made) {
    return (
      <div className="card">
        <h3>Back up your key</h3>
        <p>Download the backup file and keep it with your password. Without both, payslips sealed to this key can't be opened (your employer can re-seal them to a new key).</p>
        <div className="row">
          <button className="btn" onClick={() => downloadVault(made)}>Download backup</button>
          <button className="btn ghost" onClick={onDone}>I've saved it, continue</button>
        </div>
      </div>
    );
  }

  const importFile = async (file: File) => {
    try {
      const v = JSON.parse(await file.text()) as Vault;
      if (v.address !== address) throw new Error(`that backup belongs to ${v.address}`);
      setVault(v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "that file is not a Cista key backup");
    }
  };

  if (vault) {
    return (
      <div className="card">
        <h3>Unlock your key</h3>
        {error && <Notice kind="bad">{error}</Notice>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await unlockKeys(address, password, vault);
              onDone();
            });
          }}
        >
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn" disabled={busy || !password}>{busy ? "Unlocking…" : "Unlock"}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="card">
        <h3>Make a new key</h3>
        {error && <Notice kind="bad">{error}</Notice>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== repeat) return setError("the two passwords differ");
            void run(async () => setMade(await createKeys(address, password)));
          }}
        >
          <div className="field">
            <label htmlFor="pw1">Password <span className="hint">at least 10 characters</span></label>
            <input id="pw1" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw2">Same password again</label>
            <input id="pw2" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </div>
          <button className="btn" disabled={busy || password.length < 10}>{busy ? "Making the key…" : "Make my key"}</button>
        </form>
      </div>
      <div className="card">
        <h3>Use a backup</h3>
        <p>Set up on another browser already? Load the backup file you downloaded there.</p>
        <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
      </div>
    </div>
  );
}
