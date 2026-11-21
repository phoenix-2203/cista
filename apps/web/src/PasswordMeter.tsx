import { estimate, type Strength } from "./lib/strength";

/** A four-step bar under a new-password field, with a plain-language hint. */
export function PasswordMeter({ password, avoid }: { password: string; avoid?: string[] }) {
  const s: Strength = estimate(password, avoid);
  if (!password) return null;
  return (
    <div className="meter" data-score={s.score} aria-live="polite">
      <div className="meter-bar" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={s.score >= i ? "on" : ""} />)}</div>
      <span className="meter-label">{s.label}</span>
      {s.hint && <span className="meter-hint">{s.hint}</span>}
    </div>
  );
}
