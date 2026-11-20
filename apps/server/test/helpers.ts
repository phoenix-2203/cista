import { buildPayRun, signInStatement, signedRunStatement, unsignedRun, type Payslip, type SignedRun } from "@phoenix-2203/cista";
import { generateSealKeys, recipientOf, signRecipientCard } from "@qorechain/qoreseal";
import { addressFromPublicKey, classicalKeyFromPrivate, pqKeyFromSeed, signMessage } from "@qorechain/qoresign";
import { createApp } from "../src/app";
import type { ServerChain } from "../src/chain";
import { Store } from "../src/db";
import { sealPayslip, type PaymentTx } from "@phoenix-2203/cista";

export const CHAIN = "qorechain-diana";
export const DOMAIN = "cista.test";

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** A throwaway in-memory account: random keys, never on chain. */
export function account() {
  const classicalKey = classicalKeyFromPrivate(random(32), "secp256k1");
  const pqKey = pqKeyFromSeed(random(32));
  const sealKeys = generateSealKeys();
  const address = addressFromPublicKey(classicalKey.publicKey, "secp256k1").bech32;
  return {
    address,
    pqKey,
    sealKeys,
    sign: (text: string, pq = true) => signMessage({ chainId: CHAIN, signer: address, data: text, classicalKey, pqKey: pq ? pqKey : undefined }),
    card: () => signRecipientCard({ chainId: CHAIN, address, keys: sealKeys, classicalKey, pqKey }),
  };
}
export type Account = ReturnType<typeof account>;

export function world() {
  const store = new Store();
  const pq = new Map<string, Uint8Array>();
  const kem = new Map<string, Uint8Array>();
  const txs = new Map<string, PaymentTx>();
  const register = (...as: Account[]) => as.forEach((a) => { pq.set(a.address, a.pqKey.publicKey); kem.set(a.address, a.sealKeys.mlkemPublicKey); });
  const chain: ServerChain = {
    pqKey: async (a) => (pq.has(a) ? { publicKey: pq.get(a)!, possessionProven: true } : null),
    kemKey: async (a) => kem.get(a) ?? null,
    paymentTx: async (h) => txs.get(h.toUpperCase()) ?? null,
  };
  let clock = Date.parse("2026-11-28T09:00:00Z");
  const app = createApp({ store, chain, domain: DOMAIN, chainId: CHAIN, now: () => clock });
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  const signIn = async (a: Account) => {
    const n = (await (await call("POST", "/api/auth/nonce")).json()) as { nonce: string; issuedAt: string };
    const statement = signInStatement({ domain: DOMAIN, address: a.address, chainId: CHAIN, nonce: n.nonce, issuedAt: n.issuedAt });
    const r = await call("POST", "/api/auth/verify", { address: a.address, nonce: n.nonce, issuedAt: n.issuedAt, signature: a.sign(statement) });
    return ((await r.json()) as { token: string }).token;
  };
  return { store, pq, kem, txs, register, chain, app, call, signIn, tick: (ms: number) => (clock += ms) };
}

export function slipFor(employer: Account, employee: Account, amount: bigint): Payslip {
  return {
    version: 1,
    employer: { address: employer.address, name: "Acme Logistics Ltd" },
    employee: { address: employee.address, name: "Test Employee", staffId: "T-1", role: "Analyst", employedSince: "2025-01-01" },
    period: "2026-11",
    payDate: "2026-11-28",
    currency: "NGN",
    earnings: [{ code: "basic", label: "Basic", amount: 50_000_000n }],
    deductions: [{ code: "paye", label: "PAYE", amount: 5_000_000n }],
    employerContributions: [],
    payout: { address: employee.address, denom: "uqor", amount },
    thresholds: [10_000_000n],
  };
}

/** A signed two-person run with sealed payslips, ready to upload. */
export function preparedRun(employer: Account, a: Account, b: Account) {
  const run = buildPayRun(CHAIN, [
    { slip: slipFor(employer, a, 100n), seed: random(32) },
    { slip: slipFor(employer, b, 200n), seed: random(32) },
  ]);
  const body = unsignedRun(run);
  const signed: SignedRun = { ...body, signature: employer.sign(signedRunStatement(body)) };
  const envelopes = run.slips.map((s, i) => {
    const who = i === 0 ? a : b;
    return { employee: who.address, envelope: sealPayslip(run, s, { employee: recipientOf(who.sealKeys), employer: recipientOf(employer.sealKeys) }) };
  });
  return { run, signed, envelopes };
}
