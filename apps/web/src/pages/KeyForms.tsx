/** The forms around the sealing key: unlock, show the recovery phrase, recover with it. */
import { useState } from "react";
import { RECOVERY_WORDS, type Vault } from "@phoenix-2203/cista";
import { Notice, useAction } from "../components";
import { downloadVault, recoverKeys, unlockKeys } from "../lib/keys";

export function UnlockForm({ address, vault, onDone, onForgot }: { address: string; vault?: Vault | null; onDone: () => void; onForgot: () => void }) {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
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
      <div className="field">
        <label htmlFor="unlock-pw">Password</label>
        <input id="unlock-pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn" disabled={busy || !password}>{busy ? "Unlocking…" : "Unlock"}</button>
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
        <button className="btn" disabled={!saved} onClick={onDone}>Continue</button>
        <button className="btn ghost small" onClick={() => downloadVault(vault)}>Also download a password-locked backup</button>
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
          </div>
          <div className="field">
            <label htmlFor="npw2">Same password again</label>
            <input id="npw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <button className="btn" disabled={busy || !phrase.trim() || pw.length < 10}>{busy ? "Rebuilding your key…" : "Recover my key"}</button>
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
