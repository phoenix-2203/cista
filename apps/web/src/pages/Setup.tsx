/**
 * The sealing key, for employees and employers alike: make it (and write down
 * its recovery phrase), unlock it, recover it, or start over; then publish
 * the key card.
 */
import { useEffect, useState } from "react";
import { estimate, MIN_SCORE } from "../lib/strength";
import { PasswordMeter } from "../PasswordMeter";
import type { Vault } from "@phoenix-2203/cista";
import { Notice, SignInCard, useAction } from "../components";
import { addPasskey, createKeys, forgetPasskey, hasPasskey, lockKeys, restoreKeys, savedVault, unlockedKeys } from "../lib/keys";
import { passkeysAvailable } from "../lib/passkey";
import { useSession } from "../lib/useSession";
import { PhraseView, RecoverForm, UnlockForm } from "./KeyForms";
import { NeedsKeyStatus } from "./SetupStatus";

type Mode = "auto" | "forgot" | "new" | "phrase" | "recovered";

export function Setup() {
  const session = useSession();
  if (!session) return <SignInCard why="Your Cista key belongs to your QoreChain account." />;
  return (
    <>
      <h1>Your Cista key</h1>
      <p className="muted">
        Payslips are sealed to this key with ML-KEM-1024 and X25519, so only you (and your employer, who made the payslip) can open them.
        It's made in this browser and never leaves it unlocked.
      </p>
      <KeyDesk key={session.address} address={session.address} />
    </>
  );
}

function KeyDesk({ address }: { address: string }) {
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(location.search).has("forgot") ? "forgot" : "auto"));
  const [made, setMade] = useState<{ phrase: string; vault: Vault } | null>(null);
  const [matches, setMatches] = useState<boolean | null>(null);
  const [vault, setVault] = useState<Vault | null>(() => savedVault(address));
  const [, rerender] = useState(0);
  const refresh = () => rerender((n) => n + 1);

  useEffect(() => {
    void restoreKeys(address).then(refresh);
    const on = () => refresh();
    window.addEventListener("cista:keys", on);
    return () => window.removeEventListener("cista:keys", on);
  }, [address]);

  const keys = unlockedKeys(address);

  if (mode === "phrase" && made) return <PhraseView phrase={made.phrase} vault={made.vault} onDone={() => { setMade(null); setMode("auto"); }} />;
  if (mode === "forgot") {
    return (
      <RecoverForm
        address={address}
        onCancel={() => setMode("auto")}
        onStartOver={() => setMode("new")}
        onDone={(m) => { setMatches(m); setVault(savedVault(address)); setMode("recovered"); }}
      />
    );
  }
  if (mode === "new" || (!vault && !keys)) {
    return <MakeKey address={address} replacing={Boolean(vault)} onMade={(m) => { setMade(m); setVault(m.vault); setMode("phrase"); }} onCancel={vault ? () => setMode("auto") : undefined} />;
  }
  if (!keys) {
    return (
      <div className="card">
        <h3>Unlock your key</h3>
        <UnlockForm address={address} vault={vault} onDone={refresh} onForgot={() => setMode("forgot")} />
      </div>
    );
  }
  return (
    <>
      {mode === "recovered" && matches === true && <Notice kind="ok">Key recovered. It's the same key as before, so all your payslips open.</Notice>}
      {mode === "recovered" && matches === false && (
        <Notice kind="bad">
          That phrase makes a different key from the one you published. If you have the right phrase, recover again with it. Otherwise, publish
          this key below and ask your employer to re-seal your past payslips.
        </Notice>
      )}
      <NeedsKeyStatus address={address} keys={keys} />
      <PasskeyCard address={address} />
      <div className="row">
        <button className="btn ghost small" onClick={() => lockKeys(address)}>Lock now</button>
        <button className="btn ghost small" onClick={() => setMode("new")}>Start over with a new key</button>
      </div>
    </>
  );
}

function MakeKey({ address, replacing, onMade, onCancel }: { address: string; replacing: boolean; onMade: (m: { phrase: string; vault: Vault }) => void; onCancel?: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const { busy, error, setError, run } = useAction();
  return (
    <div className="card">
      <h3>{replacing ? "Start over with a new key" : "Make your key"}</h3>
      {replacing && (
        <Notice kind="bad">
          A new key can't open payslips sealed to your old one. Use this only if you've lost both your password and your recovery phrase; your
          employer can then re-seal your past payslips to the new key.
        </Notice>
      )}
      <p>Choose a password to unlock the key in this browser. Next you'll get a 24-word recovery phrase in case you forget it.</p>
      {error && <Notice kind="bad">{error}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pw !== pw2) return setError("the two passwords differ");
          if (estimate(pw, [address, address.slice(0, 12)]).score < MIN_SCORE) return setError("choose a stronger password");
          void run(async () => onMade(await createKeys(address, pw)));
        }}
      >
        <div className="grid">
          <div className="field">
            <label htmlFor="pw1">Password <span className="hint">at least 10 characters</span></label>
            <input id="pw1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <PasswordMeter password={pw} avoid={[address, address.slice(0, 12)]} />
          </div>
          <div className="field">
            <label htmlFor="pw2">Same password again</label>
            <input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <button className="btn" disabled={busy || pw.length < 10 || estimate(pw, [address, address.slice(0, 12)]).score < MIN_SCORE}>{busy ? "Making the key…" : replacing ? "Make a new key" : "Make my key"}</button>
          {onCancel && <button type="button" className="btn ghost small" onClick={onCancel}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}

/** Unlock with Face ID, a fingerprint or a security key instead of the password. */
function PasskeyCard({ address }: { address: string }) {
  const { busy, error, run } = useAction();
  const [, rerender] = useState(0);
  if (!passkeysAvailable()) return null;
  const on = hasPasskey(address);
  return (
    <div className="card passkey-card">
      <div>
        <h3>{on ? "Passkey unlock is on" : "Unlock with a passkey"}</h3>
        <p className="small muted">
          {on
            ? "This browser unlocks your key with your passkey. Your password and recovery phrase still work."
            : "Use Face ID, a fingerprint, Windows Hello or a security key instead of typing your password. It stays in this browser; your password and recovery phrase keep working."}
        </p>
        {error && <Notice kind="bad">{error}</Notice>}
      </div>
      {on ? (
        <button className="btn ghost small" onClick={() => { forgetPasskey(address); rerender((n) => n + 1); }}>Turn off</button>
      ) : (
        <button className="btn small" disabled={busy} onClick={() => run(async () => { await addPasskey(address); rerender((n) => n + 1); })}>{busy ? "Waiting for your passkey…" : "Set up a passkey"}</button>
      )}
    </div>
  );
}
