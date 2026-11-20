/**
 * The Cista server's API, and the signed-in session.
 *
 * The session token lives in sessionStorage: it ends when the tab closes and
 * is only good for 12 hours. It lets the server hand back your own sealed
 * payslips; it cannot open them, and it cannot sign anything.
 */
import { signInStatement, type MessageSignature, type SignedRun } from "@phoenix-2203/cista";
import type { RecipientCard } from "@qorechain/qoreseal";
import { CHAIN_ID, connect, signText } from "./qorex";

export interface Session {
  address: string;
  token: string;
  expiresAt: string;
}

export interface StoredRun {
  run: SignedRun;
  createdAt: string;
  payment?: { txHash: string; height: number; at: string };
}

const KEY = "cista.session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function currentSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Session | null;
    if (!s || Date.parse(s.expiresAt) <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage can be off; the session then lasts for this page only */
  }
  window.dispatchEvent(new Event("cista:session"));
}

async function call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const s = auth ? currentSession() : null;
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(s ? { authorization: `Bearer ${s.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && s) saveSession(null);
    throw new ApiError(res.status, data.error ?? `the server answered ${res.status}`);
  }
  return data as T;
}

/** Connect QoreX, sign the server's one-time statement, and start a session. */
export async function signIn(): Promise<Session> {
  const address = await connect();
  const n = await call<{ nonce: string; issuedAt: string; domain: string; chainId: string }>("POST", "/api/auth/nonce", undefined, false);
  if (n.chainId !== CHAIN_ID) throw new Error(`the server is set up for ${n.chainId}, this app for ${CHAIN_ID}`);
  if (n.domain !== location.host) throw new Error(`the server expects sign-ins for ${n.domain}, but this page is ${location.host}`);
  const statement = signInStatement({ domain: n.domain, address, chainId: CHAIN_ID, nonce: n.nonce, issuedAt: n.issuedAt });
  const signature = await signText(address, statement);
  const s = await call<Session>("POST", "/api/auth/verify", { address, nonce: n.nonce, issuedAt: n.issuedAt, signature }, false);
  saveSession(s);
  return s;
}

export async function signOut(): Promise<void> {
  await call("POST", "/api/auth/logout").catch(() => undefined);
  saveSession(null);
}

export const api = {
  /** An account's key card: its ML-KEM-1024 key (hex) and the card it signed for it. */
  card: (address: string) => call<{ card: RecipientCard; mlkemPublicKey: string }>("GET", `/api/cards/${address}`, undefined, false),
  putCard: (card: RecipientCard, mlkemPublicKey: string) => call<{ ok: true }>("POST", "/api/cards", { card, mlkemPublicKey }),
  uploadRun: (run: SignedRun, envelopes: { employee: string; envelope: string }[]) =>
    call<{ ok: true; runRoot: string }>("POST", "/api/runs", { run, envelopes }),
  myRuns: () => call<{ runs: StoredRun[] }>("GET", "/api/runs").then((r) => r.runs),
  run: (root: string) => call<StoredRun>("GET", `/api/runs/${root}`, undefined, false),
  runEnvelopes: (root: string) => call<{ envelopes: { employee: string; envelope: string }[] }>("GET", `/api/runs/${root}/envelopes`).then((r) => r.envelopes),
  recordPayment: (root: string, txHash: string) => call<{ ok: true; payment: StoredRun["payment"] }>("POST", `/api/runs/${root}/payment`, { txHash }),
  inbox: () =>
    call<{ payslips: { run: SignedRun; payment?: StoredRun["payment"]; envelope: string }[] }>("GET", "/api/me/payslips").then((r) => r.payslips),
};

export type { MessageSignature };
