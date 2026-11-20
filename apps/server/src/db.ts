/**
 * Cista's store (SQLite, built into Node 22).
 *
 * What it holds: signed pay runs, their payment hashes, sealed payslip
 * envelopes (ciphertext), public recipient cards, sign-in nonces and hashed
 * session tokens. What it never holds: a payslip in the clear, a salt seed, or
 * any private key. A full copy of this database tells an attacker who employs
 * whom and when, but not what anyone is paid beyond what the chain already shows.
 */
import { DatabaseSync } from "node:sqlite";
import type { SignedRun } from "@phoenix-2203/cista";

export interface StoredRun {
  run: SignedRun;
  createdAt: string;
  payment?: { txHash: string; height: number; at: string };
}

export interface InboxItem {
  run: SignedRun;
  envelope: Uint8Array;
  payment?: { txHash: string; height: number; at: string };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_root    TEXT PRIMARY KEY,
  employer    TEXT NOT NULL,
  period      TEXT NOT NULL,
  signed_run  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  payment_tx  TEXT,
  paid_height INTEGER,
  paid_at     TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_employer ON runs (employer, period);
CREATE UNIQUE INDEX IF NOT EXISTS runs_by_payment ON runs (payment_tx) WHERE payment_tx IS NOT NULL;
CREATE TABLE IF NOT EXISTS envelopes (
  run_root  TEXT NOT NULL REFERENCES runs (run_root),
  employee  TEXT NOT NULL,
  envelope  BLOB NOT NULL,
  PRIMARY KEY (run_root, employee)
);
CREATE INDEX IF NOT EXISTS envelopes_by_employee ON envelopes (employee);
CREATE TABLE IF NOT EXISTS cards (
  address    TEXT PRIMARY KEY,
  card       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nonces (
  nonce      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  hasRun(runRoot: string): boolean {
    return this.db.prepare("SELECT 1 FROM runs WHERE run_root = ?").get(runRoot) !== undefined;
  }

  /** Stores a signed run with its envelopes, all or nothing. */
  addRun(run: SignedRun, envelopes: { employee: string; envelope: Uint8Array }[], now = new Date()): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO runs (run_root, employer, period, signed_run, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(run.runRoot, run.employer, run.period, JSON.stringify(run), now.toISOString());
      const put = this.db.prepare("INSERT INTO envelopes (run_root, employee, envelope) VALUES (?, ?, ?)");
      for (const e of envelopes) put.run(run.runRoot, e.employee, e.envelope);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  setPayment(runRoot: string, txHash: string, height: number, now = new Date()): void {
    this.db.prepare("UPDATE runs SET payment_tx = ?, paid_height = ?, paid_at = ? WHERE run_root = ? AND payment_tx IS NULL")
      .run(txHash, height, now.toISOString(), runRoot);
  }

  getRun(runRoot: string): StoredRun | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE run_root = ?").get(runRoot) as Record<string, unknown> | undefined;
    return row ? toStoredRun(row) : undefined;
  }

  runsOf(employer: string): StoredRun[] {
    return (this.db.prepare("SELECT * FROM runs WHERE employer = ? ORDER BY period DESC, created_at DESC").all(employer) as Record<string, unknown>[]).map(toStoredRun);
  }

  envelopesOf(runRoot: string): { employee: string; envelope: Uint8Array }[] {
    return (this.db.prepare("SELECT employee, envelope FROM envelopes WHERE run_root = ? ORDER BY employee").all(runRoot) as { employee: string; envelope: Uint8Array }[])
      .map((r) => ({ employee: r.employee, envelope: new Uint8Array(r.envelope) }));
  }

  /** Swaps in a re-sealed envelope for a payslip already in the run. */
  replaceEnvelope(runRoot: string, employee: string, envelope: Uint8Array): boolean {
    const r = this.db.prepare("UPDATE envelopes SET envelope = ? WHERE run_root = ? AND employee = ?").run(envelope, runRoot, employee);
    return r.changes === 1;
  }

  inboxOf(employee: string): InboxItem[] {
    const rows = this.db.prepare(
      `SELECT r.*, e.envelope FROM envelopes e JOIN runs r ON r.run_root = e.run_root
       WHERE e.employee = ? ORDER BY r.period DESC, r.created_at DESC`,
    ).all(employee) as Record<string, unknown>[];
    return rows.map((row) => {
      const s = toStoredRun(row);
      return { run: s.run, payment: s.payment, envelope: new Uint8Array(row.envelope as Uint8Array) };
    });
  }

  putCard(address: string, card: unknown, now = new Date()): void {
    this.db.prepare("INSERT INTO cards (address, card, updated_at) VALUES (?, ?, ?) ON CONFLICT (address) DO UPDATE SET card = excluded.card, updated_at = excluded.updated_at")
      .run(address, JSON.stringify(card), now.toISOString());
  }

  getCard(address: string): unknown | undefined {
    const row = this.db.prepare("SELECT card FROM cards WHERE address = ?").get(address) as { card: string } | undefined;
    return row ? JSON.parse(row.card) : undefined;
  }

  addNonce(nonce: string, expiresAt: number): void {
    this.db.prepare("INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)").run(nonce, expiresAt);
  }

  /** Uses a nonce up: true only the first time, and only before it expires. */
  takeNonce(nonce: string, now = Date.now()): boolean {
    const r = this.db.prepare("DELETE FROM nonces WHERE nonce = ? AND expires_at > ?").run(nonce, now);
    return r.changes === 1;
  }

  addSession(tokenHash: string, address: string, expiresAt: number): void {
    this.db.prepare("INSERT INTO sessions (token_hash, address, expires_at) VALUES (?, ?, ?)").run(tokenHash, address, expiresAt);
  }

  sessionAddress(tokenHash: string, now = Date.now()): string | undefined {
    const row = this.db.prepare("SELECT address FROM sessions WHERE token_hash = ? AND expires_at > ?").get(tokenHash, now) as { address: string } | undefined;
    return row?.address;
  }

  dropSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  sweep(now = Date.now()): void {
    this.db.prepare("DELETE FROM nonces WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }
}

function toStoredRun(row: Record<string, unknown>): StoredRun {
  return {
    run: JSON.parse(row.signed_run as string) as SignedRun,
    createdAt: row.created_at as string,
    payment: row.payment_tx ? { txHash: row.payment_tx as string, height: Number(row.paid_height), at: row.paid_at as string } : undefined,
  };
}
