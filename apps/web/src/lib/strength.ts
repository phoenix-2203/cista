/**
 * A password-strength estimate, small enough to ship with the page.
 *
 * It estimates bits of entropy from the character sets used, after taking
 * out what a guesser tries first: common passwords, repeated characters,
 * keyboard rows and runs like "1234" or "abcd". A phrase of four or more
 * words is scored as words. It is a guide, not a guarantee: the vault's
 * Argon2id is what makes each guess expensive.
 */

export interface Strength {
  /** 0 very weak … 4 very strong. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
}

export const MIN_SCORE = 2;

const COMMON = new Set([
  "password", "passw0rd", "p@ssword", "p@ssw0rd", "qwerty", "qwertyuiop", "asdfghjkl", "zxcvbnm", "letmein", "welcome", "iloveyou",
  "admin", "administrator", "monkey", "dragon", "football", "baseball", "sunshine", "princess", "shadow", "master", "superman",
  "batman", "trustno1", "starwars", "whatever", "freedom", "michael", "jennifer", "charlie", "abc123", "123456", "1234567",
  "12345678", "123456789", "1234567890", "0123456789", "111111", "000000", "123123", "654321", "secret", "changeme", "default",
  "computer", "internet", "samsung", "google", "nigeria", "lagos", "abuja", "jesus", "blessing", "godisgood", "chelsea",
  "arsenal", "liverpool", "manchester", "cista", "qorechain", "qorex", "payroll", "payslip", "salary", "bitcoin", "crypto",
]);

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz"];

/** Length after collapsing repeats ("aaaa") and runs ("1234", "abcd", "qwer", "4321") to one character each. */
function effectiveLength(pw: string): number {
  const s = pw.toLowerCase();
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const prev = s[i - 1];
    const ch = s[i]!;
    if (prev === undefined) { n++; continue; }
    if (ch === prev) continue;
    const next = (row: string) => {
      const a = row.indexOf(prev);
      const b = row.indexOf(ch);
      return a >= 0 && b >= 0 && Math.abs(a - b) === 1;
    };
    if (ROWS.some(next)) continue;
    n++;
  }
  return n;
}

function charset(pw: string): number {
  let size = 0;
  if (/[a-z]/.test(pw)) size += 26;
  if (/[A-Z]/.test(pw)) size += 26;
  if (/\d/.test(pw)) size += 10;
  if (/[^A-Za-z0-9\s]/.test(pw)) size += 33;
  if (/\s/.test(pw)) size += 1;
  if (/[^\x00-\x7f]/.test(pw)) size += 100;
  return Math.max(size, 1);
}

/** The core of a password with digits and symbols trimmed from both ends: "Password123!" → "password". */
const core = (pw: string) => pw.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");

export function estimate(pw: string, avoid: string[] = []): Strength {
  if (pw.length === 0) return { score: 0, label: "", hint: "" };
  const lower = pw.toLowerCase();
  const words = pw.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3);
  let bits = effectiveLength(pw) * Math.log2(charset(pw));
  // A passphrase of random-looking words: about 11 bits a word, conservatively.
  if (words.length >= 4 && pw.length >= 20) bits = Math.max(bits, words.filter((w) => !COMMON.has(w.toLowerCase())).length * 11);
  let hint = "";
  if (COMMON.has(lower) || COMMON.has(core(pw))) { bits = Math.min(bits, 10); hint = "This is one of the first passwords anyone tries."; }
  for (const a of avoid.map((x) => x.toLowerCase()).filter((x) => x.length >= 4)) {
    // The guesser knows the address: the part copied from it adds nothing.
    if (lower.includes(a)) { bits -= effectiveLength(a) * Math.log2(charset(pw)); hint = "Leave out your account address."; }
  }
  const score: Strength["score"] = bits < 28 ? 0 : bits < 36 ? 1 : bits < 50 ? 2 : bits < 64 ? 3 : 4;
  const label = ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score]!;
  if (!hint) {
    if (pw.length < 10) hint = "Use at least 10 characters.";
    else if (score < 3) hint = "Longer is better: four or five unrelated words make a strong, memorable password.";
  }
  return { score, label, hint };
}
