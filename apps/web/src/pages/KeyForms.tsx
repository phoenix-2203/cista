/** The forms around the sealing key: unlock, show the recovery phrase, recover with it. */
import { useState } from "react";
import { estimate, MIN_SCORE } from "../lib/strength";
import { PasswordMeter } from "../PasswordMeter";
import { RECOVERY_WORDS, type Vault } from "@phoenix-2203/cista";
import { Notice, useAction } from "../components";
import { downloadVault, hasPasskey, recoverKeys, unlockKeys, unlockKeysWithPasskey } from "../lib/keys";
import { pickPositions, sameWord } from "../lib/phrasecheck";

export function UnlockForm({ address, vault, onDone, onForgot }: { address: string; vault?: Vault | null; onDone: () => void; onForgot: () => void }) {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const passkey = hasPasskey(address);
  const withPasskey = () =>
    run(async () => {
      await unlockKeysWithPasskey(address);
      onDone();
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await unlockKeys(address, password, vault ?? undefined);
          onDone();
        });
      }}
    >
      {error && <Notice kind="bad">{error}</Notice>}
      {passkey && (
        <div className="passkey-unlock">
          <button type="button" className="btn" disabled={busy} onClick={withPasskey}>{busy ? "Waiting for your passkey…" : "Unlock with passkey"}</button>
          <span className="small muted">or type your password</span>
        </div>
      )}
      <div className="field">
        <label htmlFor="unlock-pw">Password</label>
        <input id="unlock-pw" type="password" autoComplete="current-password" autoFocus={!passkey} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="row">
        <button className={passkey ? "btn ghost" : "btn"} disabled={busy || !password}>{busy ? "Unlocking…" : "Unlock"}</button>
        <button type="button" className="btn ghost small" onClick={onForgot}>Forgot your password?</button>
      </div>
      <p className="small muted" style={{ marginTop: "0.7rem" }}>Stays unlocked in this tab until you close it, or after 30 minutes without use.</p>
    </form>
  );
}

export function PhraseView({ phrase, vault, onDone }: { phrase: string; vault: Vault; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(phrase);
    setCopied(true);
    // Don't leave the phrase on the clipboard: clear it after a minute (if it's still ours).
    setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === phrase) await navigator.clipboard.writeText("");
      } catch {
        /* reading the clipboard needs focus or permission; nothing more to do */
      }
      setCopied(false);
    }, 60_000);
  };
  const words = phrase.split(" ");
  const [checking, setChecking] = useState(false);
  if (checking) return <PhraseCheck words={words} onBack={() => setChecking(false)} onDone={onDone} />;
  return (
    <div className="card">
      <h3>Write down your recovery phrase</h3>
      <p>
        These {RECOVERY_WORDS} words rebuild your Cista key if you forget your password, so your payslips stay readable. Write them on paper, in
        order. This is the only time they are shown.
      </p>
      <ol className="phrase">
        {words.map((w, i) => (
          <li key={i}><span className="muted small">{i + 1}</span> {w}</li>
        ))}
      </ol>
      <div className="row" style={{ marginBottom: "0.8rem" }}>
        <button className="btn ghost small" onClick={() => void copy()}>{copied ? "Copied (cleared in 1 minute)" : "Copy the 24 words"}</button>
        <span className="small muted">Paste only into a password manager. Never into a chat, email or screenshot.</span>
      </div>
      <Notice>
        This is not your QoreX seed phrase and it can't move any funds: it only opens payslips. Never type it anywhere except Cista's "Forgot
        your password?" form.
      </Notice>
      <label style={{ fontWeight: 400, display: "flex", gap: "0.5rem", alignItems: "center", margin: "0.8rem 0" }}>
        <input type="checkbox" style={{ width: "auto" }} checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've written down all {RECOVERY_WORDS} words in order
      </label>
      <div className="row">
        <button className="btn" disabled={!saved} onClick={() => setChecking(true)}>Continue</button>
        <button className="btn ghost small" onClick={() => downloadVault(vault)}>Also download a password-locked backup</button>
      </div>
    </div>
  );
}

/** Three words asked back from paper, so a phrase that wasn't written down is caught now, not on the day it's needed. */
function PhraseCheck({ words, onBack, onDone }: { words: string[]; onBack: () => void; onDone: () => void }) {
  const [positions] = useState(() => pickPositions(words.length));
  const [typed, setTyped] = useState<string[]>(() => positions.map(() => ""));
  const right = positions.map((p, i) => sameWord(typed[i]!, words[p]!));
  return (
    <div className="card">
      <h3>Check your recovery phrase</h3>
      <p>From what you wrote down, type these three words. The phrase isn't on screen any more, so this checks your paper copy.</p>
      <div className="grid">
        {positions.map((p, i) => (
          <div className="field" key={p}>
            <label htmlFor={`w${p}`}>Word {p + 1}</label>
            <input
              id={`w${p}`}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed[i]}
              aria-invalid={typed[i] !== "" && !right[i]}
              onChange={(e) => setTyped(typed.map((t, j) => (j === i ? e.target.value : t)))}
            />
          </div>
        ))}
      </div>
      {typed.every((t) => t.trim() !== "") && !right.every(Boolean) && (
        <Notice kind="bad">Not quite. Check the numbering on your paper, or go back and look at the words again.</Notice>
      )}
      <div className="row">
        <button className="btn" disabled={!right.every(Boolean)} onClick={onDone}>Finish</button>
        <button className="btn ghost small" onClick={onBack}>Show the words again</button>
      </div>
    </div>
  );
}

export function RecoverForm({ address, onDone, onCancel, onStartOver }: { address: string; onDone: (matchesCard: boolean | null) => void; onCancel: () => void; onStartOver: () => void }) {
  const [phrase, setPhrase] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const { busy, error, setError, run } = useAction();
  return (
    <div className="card">
      <h3>Use your recovery phrase</h3>
      <p>Type the {RECOVERY_WORDS} words you wrote down when you made your key, then choose a new password. Your payslips open again as before.</p>
      {error && <Notice kind="bad">{error}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pw !== pw2) return setError("the two passwords differ");
          if (estimate(pw, [address, address.slice(0, 12)]).score < MIN_SCORE) return setError("choose a stronger password");
          void run(async () => {
            const r = await recoverKeys(address, phrase, pw);
            onDone(r.matchesCard);
          });
        }}
      >
        <div className="field">
          <label htmlFor="phrase">Recovery phrase</label>
          <textarea id="phrase" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="word1 word2 word3 …" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        </div>
        <div className="grid">
          <div className="field">
            <label htmlFor="npw1">New password <span className="hint">at least 10 characters</span></label>
            <input id="npw1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <PasswordMeter password={pw} avoid={[address, address.slice(0, 12)]} />
          </div>
          <div className="field">
            <label htmlFor="npw2">Same password again</label>
            <input id="npw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <button className="btn" disabled={busy || !phrase.trim() || pw.length < 10 || estimate(pw, [address, address.slice(0, 12)]).score < MIN_SCORE}>{busy ? "Rebuilding your key…" : "Recover my key"}</button>
          <button type="button" className="btn ghost small" onClick={onCancel}>Back</button>
        </div>
      </form>
      <hr className="rule" />
      <p className="small muted">
        Lost the phrase too? <button className="btn ghost small" onClick={onStartOver}>Start over with a new key</button> Your employer can then
        re-seal your past payslips to it.
      </p>
    </div>
  );
}
