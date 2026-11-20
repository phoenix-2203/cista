/**
 * Cista's HTTP API.
 *
 * The server is a mailbox with checks. It verifies what it can before storing
 * anything (signatures against the chain's registered keys, payments against
 * the chain), but it cannot read a payslip and it is not trusted to: every
 * employee re-checks their payslip against the employer's signed run root, and
 * every lender re-checks a proof against the chain.
 */
import {
  checkRunPayment,
  signInStatement,
  verifySignedRun,
  type MessageSignature,
  type SignedRun,
} from "@phoenix-2203/cista";
import { envelopeFromText, envelopeToText, parseEnvelope, verifyRecipientCard, type RecipientCard } from "@qorechain/qoreseal";
import { verifyMessage } from "@qorechain/qoresign";
import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ServerChain } from "./chain";
import type { Store } from "./db";

export interface AppConfig {
  store: Store;
  chain: ServerChain;
  /** The site's host, as it appears in sign-in statements. */
  domain: string;
  chainId: string;
  now?: () => number;
}

export const NONCE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 12 * 60 * 60_000;
export const MAX_ENVELOPE_BYTES = 64 * 1024;
export const MAX_RUN_BODY_BYTES = 4 * 1024 * 1024;

const QOR = /^qor1[02-9ac-hj-np-z]{38}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const TXHASH = /^[0-9A-Fa-f]{64}$/;

type Env = { Variables: { address?: string } };

class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 502, message: string) {
    super(message);
  }
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

async function json<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, "the request body must be JSON");
  }
}

export function createApp(cfg: AppConfig): Hono<Env> {
  const { store, chain } = cfg;
  const now = cfg.now ?? (() => Date.now());
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "something went wrong on the server" }, 500);
  });

  // Who is signed in, from "Authorization: Bearer <token>".
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("authorization");
    if (auth?.startsWith("Bearer ")) {
      const address = store.sessionAddress(hash(auth.slice(7).trim()), now());
      if (address) c.set("address", address);
    }
    await next();
  });

  const signedIn = (c: Context<Env>): string => {
    const a = c.get("address");
    if (!a) throw new HttpError(401, "sign in first");
    return a;
  };

  const pqKeyOf = async (address: string) => {
    const k = await chain.pqKey(address);
    if (!k) throw new HttpError(403, `${address} has no post-quantum key registered on chain`);
    return k;
  };

  app.get("/api/health", (c) => c.json({ ok: true, chainId: cfg.chainId }));

  // --- Sign-in ---------------------------------------------------------------

  app.post("/api/auth/nonce", (c) => {
    store.sweep(now());
    const nonce = randomBytes(16).toString("hex");
    store.addNonce(nonce, now() + NONCE_TTL_MS);
    return c.json({ nonce, issuedAt: new Date(now()).toISOString(), domain: cfg.domain, chainId: cfg.chainId });
  });

  app.post("/api/auth/verify", async (c) => {
    const b = await json<{ address?: string; nonce?: string; issuedAt?: string; signature?: MessageSignature }>(c);
    if (!b.address || !QOR.test(b.address)) throw new HttpError(400, "address must be a qor1 address");
    if (typeof b.nonce !== "string" || typeof b.issuedAt !== "string" || !b.signature) throw new HttpError(400, "nonce, issuedAt and signature are required");
    const issued = Date.parse(b.issuedAt);
    if (Number.isNaN(issued) || Math.abs(now() - issued) > NONCE_TTL_MS) throw new HttpError(401, "this sign-in is too old; try again");
    if (!store.takeNonce(b.nonce, now())) throw new HttpError(401, "this sign-in was already used or has expired; try again");
    const statement = signInStatement({ domain: cfg.domain, address: b.address, chainId: cfg.chainId, nonce: b.nonce, issuedAt: b.issuedAt });
    if (b.signature.signatureType !== "ml-dsa-87-hybrid" || !b.signature.pq) throw new HttpError(401, "sign-in needs the ML-DSA-87 signature, not only the classical one");
    const key = await pqKeyOf(b.address);
    try {
      verifyMessage({ chainId: cfg.chainId, signer: b.address, data: statement, signature: b.signature, pqPublicKey: key.publicKey, requirePq: true });
    } catch {
      throw new HttpError(401, "the sign-in signature does not verify against this account's registered keys");
    }
    const token = randomBytes(32).toString("hex");
    const expiresAt = now() + SESSION_TTL_MS;
    store.addSession(hash(token), b.address, expiresAt);
    return c.json({ token, address: b.address, expiresAt: new Date(expiresAt).toISOString() });
  });

  app.post("/api/auth/logout", (c) => {
    const auth = c.req.header("authorization");
    if (auth?.startsWith("Bearer ")) store.dropSession(hash(auth.slice(7).trim()));
    return c.json({ ok: true });
  });

  // --- Recipient cards (public X25519 keys, signed by the account) -----------

  // A card holds the account's ML-KEM-1024 and X25519 public keys. The card
  // names the ML-KEM key by its SHA3-256 and is signed (hybrid) by the account,
  // so anyone can check it against the account's registered ML-DSA-87 key.
  // QoreX does not let websites register an ML-KEM key in the chain's KEM
  // registry (it keeps MsgRegisterKEMKey for the wallet itself), so the full
  // ML-KEM key travels with the signed card instead.
  app.get("/api/cards/:address", (c) => {
    const entry = store.getCard(c.req.param("address")) as { card: RecipientCard; mlkemPublicKey: string } | undefined;
    if (!entry) throw new HttpError(404, "no key card for this address");
    return c.json(entry);
  });

  app.post("/api/cards", async (c) => {
    const me = signedIn(c);
    const { card, mlkemPublicKey } = await json<{ card?: RecipientCard; mlkemPublicKey?: string }>(c);
    if (!card || card.address !== me) throw new HttpError(403, "you can only publish your own card");
    if (card.chainId !== cfg.chainId) throw new HttpError(400, `the card is for ${card.chainId}, not ${cfg.chainId}`);
    if (typeof mlkemPublicKey !== "string" || !/^[0-9a-f]{3136}$/.test(mlkemPublicKey)) {
      throw new HttpError(400, "mlkemPublicKey must be the 1,568-byte ML-KEM-1024 key in lowercase hex");
    }
    const pq = await pqKeyOf(me);
    try {
      verifyRecipientCard({ card, chainId: cfg.chainId, address: me, pqPublicKey: pq.publicKey, mlkemPublicKey: Buffer.from(mlkemPublicKey, "hex") });
    } catch (e) {
      throw new HttpError(400, `the card does not check out: ${(e as Error).message}`);
    }
    store.putCard(me, { card, mlkemPublicKey });
    return c.json({ ok: true });
  });

  // --- Pay runs ---------------------------------------------------------------

  app.post("/api/runs", bodyLimit({ maxSize: MAX_RUN_BODY_BYTES, onError: (c) => c.json({ error: "this pay run is too large" }, 413) }), async (c) => {
    const me = signedIn(c);
    const b = await json<{ run?: SignedRun; envelopes?: { employee?: string; envelope?: string }[] }>(c);
    const run = b.run;
    if (!run || typeof run !== "object") throw new HttpError(400, "run is required");
    if (run.employer !== me) throw new HttpError(403, "you can only upload your own pay runs");
    if (run.chainId !== cfg.chainId) throw new HttpError(400, `the run is for ${run.chainId}, not ${cfg.chainId}`);
    if (typeof run.runRoot !== "string" || !HEX32.test(run.runRoot)) throw new HttpError(400, "run root must be 32 bytes of lowercase hex");
    if (!Array.isArray(b.envelopes) || b.envelopes.length !== run.count) throw new HttpError(400, "send exactly one sealed payslip per payslip in the run");
    if (store.hasRun(run.runRoot)) throw new HttpError(409, "this pay run is already stored");

    const envelopes: { employee: string; envelope: Uint8Array }[] = [];
    const seen = new Set<string>();
    for (const e of b.envelopes) {
      if (!e?.employee || !QOR.test(e.employee)) throw new HttpError(400, "each sealed payslip needs the employee's qor1 address");
      if (seen.has(e.employee)) throw new HttpError(400, `${e.employee} has two sealed payslips`);
      seen.add(e.employee);
      if (typeof e.envelope !== "string" || e.envelope.length > MAX_ENVELOPE_BYTES * 2) throw new HttpError(400, "a sealed payslip is missing or too large");
      let bytes: Uint8Array;
      try {
        bytes = envelopeFromText(e.envelope);
        parseEnvelope(bytes);
      } catch {
        throw new HttpError(400, `the sealed payslip for ${e.employee} is not a QoreSeal envelope`);
      }
      if (bytes.length > MAX_ENVELOPE_BYTES) throw new HttpError(400, "a sealed payslip is too large");
      envelopes.push({ employee: e.employee, envelope: bytes });
    }

    const key = await pqKeyOf(me);
    try {
      verifySignedRun(run, key.publicKey);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    store.addRun(run, envelopes);
    return c.json({ ok: true, runRoot: run.runRoot }, 201);
  });

  app.get("/api/runs", (c) => {
    const me = signedIn(c);
    return c.json({ runs: store.runsOf(me) });
  });

  app.get("/api/runs/:root", (c) => {
    const s = store.getRun(c.req.param("root"));
    if (!s) throw new HttpError(404, "no such pay run");
    return c.json(s);
  });

  app.get("/api/runs/:root/envelopes", (c) => {
    const me = signedIn(c);
    const s = store.getRun(c.req.param("root"));
    if (!s) throw new HttpError(404, "no such pay run");
    if (s.run.employer !== me) throw new HttpError(403, "only the employer can list a run's sealed payslips");
    return c.json({ envelopes: store.envelopesOf(s.run.runRoot).map((e) => ({ employee: e.employee, envelope: envelopeToText(e.envelope) })) });
  });

  // Re-seal: the employer opens their own copy of a payslip and seals it again
  // to the employee's current key (after a lost key). The server can't tell a
  // good envelope from a bad one, and doesn't need to: the employee's browser
  // checks every payslip against the run root the employer signed.
  app.put("/api/runs/:root/envelopes/:employee", async (c) => {
    const me = signedIn(c);
    const s = store.getRun(c.req.param("root"));
    if (!s) throw new HttpError(404, "no such pay run");
    if (s.run.employer !== me) throw new HttpError(403, "only the employer can re-seal a run's payslips");
    const { envelope } = await json<{ envelope?: string }>(c);
    let bytes: Uint8Array;
    try {
      if (typeof envelope !== "string" || envelope.length > MAX_ENVELOPE_BYTES * 2) throw new Error();
      bytes = envelopeFromText(envelope);
      parseEnvelope(bytes);
    } catch {
      throw new HttpError(400, "that is not a QoreSeal envelope");
    }
    if (!store.replaceEnvelope(s.run.runRoot, c.req.param("employee"), bytes)) throw new HttpError(404, "this run has no payslip for that employee");
    return c.json({ ok: true });
  });

  app.post("/api/runs/:root/payment", async (c) => {
    const me = signedIn(c);
    const s = store.getRun(c.req.param("root"));
    if (!s) throw new HttpError(404, "no such pay run");
    if (s.run.employer !== me) throw new HttpError(403, "only the employer can record the payment");
    const { txHash } = await json<{ txHash?: string }>(c);
    if (typeof txHash !== "string" || !TXHASH.test(txHash)) throw new HttpError(400, "txHash must be a 64-character transaction hash");
    if (s.payment) {
      if (s.payment.txHash === txHash.toUpperCase()) return c.json({ ok: true, payment: s.payment });
      throw new HttpError(409, "this pay run already has a payment");
    }
    let tx;
    try {
      tx = await chain.paymentTx(txHash);
    } catch {
      throw new HttpError(502, "could not read the chain right now; try again");
    }
    if (!tx) throw new HttpError(404, "the chain does not know this transaction yet; wait a block and try again");
    const check = checkRunPayment(tx, s.run);
    if (!check.ok) throw new HttpError(400, check.problems.join(" "));
    try {
      store.setPayment(s.run.runRoot, tx.hash, tx.height, new Date(now()));
    } catch {
      throw new HttpError(409, "this transaction already paid another pay run");
    }
    return c.json({ ok: true, payment: store.getRun(s.run.runRoot)!.payment });
  });

  // --- Employee inbox ---------------------------------------------------------

  app.get("/api/me/payslips", (c) => {
    const me = signedIn(c);
    return c.json({
      payslips: store.inboxOf(me).map((i) => ({ run: i.run, payment: i.payment, envelope: envelopeToText(i.envelope) })),
    });
  });

  return app;
}
