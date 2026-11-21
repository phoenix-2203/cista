import { useId } from "react";
import { SEAL, SEAL_PATH, WORDMARK_ASPECT, WORDMARK_PATH, WORDMARK_VIEWBOX } from "./brand";

/** The wax seal alone: the dot of the i in the wordmark, and a mark on its own. */
export function Seal({ size = 20, className }: { size?: number; className?: string }) {
  const { cx, cy, r } = SEAL;
  return (
    <svg className={className} width={size} height={size} viewBox={`${cx - r} ${cy - r} ${2 * r} ${2 * r}`} aria-hidden="true">
      <SealShape />
    </svg>
  );
}

function SealShape() {
  const id = useId();
  const { cx, cy, r } = SEAL;
  return (
    <>
      <defs>
        <radialGradient id={id} cx="38%" cy="32%" r="75%">
          <stop offset="0" style={{ stopColor: "var(--wax-1)" }} />
          <stop offset=".55" style={{ stopColor: "var(--wax-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--wax-3)" }} />
        </radialGradient>
      </defs>
      <path d={SEAL_PATH} fill={`url(#${id})`} />
      <circle cx={cx} cy={cy} r={r * 0.6} fill="none" style={{ stroke: "var(--wax-3)" }} strokeOpacity={0.55} strokeWidth={r * 0.09} />
      <circle cx={cx - r * 0.02} cy={cy - r * 0.03} r={r * 0.6} fill="none" style={{ stroke: "var(--wax-1)" }} strokeOpacity={0.45} strokeWidth={r * 0.04} />
    </>
  );
}

/** "cista" in Instrument Serif, with a wax seal for the dot of the i. Ink follows the theme. */
export function Wordmark({ height = 30 }: { height?: number }) {
  return (
    <svg className="wordmark" height={height} width={height * WORDMARK_ASPECT} viewBox={WORDMARK_VIEWBOX} role="img" aria-label="Cista">
      <path d={WORDMARK_PATH} fill="currentColor" />
      <SealShape />
    </svg>
  );
}
