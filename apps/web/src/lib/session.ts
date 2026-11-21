/** The signed-in session, kept in sessionStorage. No crypto here, so any page can read it cheaply. */

export interface Session {
  address: string;
  token: string;
  expiresAt: string;
}

const KEY = "cista.session";

export function currentSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Session | null;
    if (!s || Date.parse(s.expiresAt) <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage can be off; the session then lasts for this page only */
  }
  window.dispatchEvent(new Event("cista:session"));
}

