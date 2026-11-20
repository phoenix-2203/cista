import { openPayslip, parsePaymentTx, runMemo, fromHex } from "@phoenix-2203/cista";
import { envelopeFromText, envelopeToText } from "@qorechain/qoreseal";
import { describe, expect, it } from "vitest";
import { NONCE_TTL_MS } from "../src/app";
import { account, CHAIN, preparedRun, world } from "./helpers";

const employer = account();
const ada = account();
const bayo = account();
const thief = account();

async function setup() {
  const w = world();
  w.register(employer, ada, bayo, thief);
  const boss = await w.signIn(employer);
  const p = preparedRun(employer, ada, bayo);
  const upload = (token = boss, run = p.signed, envelopes = p.envelopes.map((e) => ({ employee: e.employee, envelope: envelopeToText(e.envelope) }))) =>
    w.call("POST", "/api/runs", { run, envelopes }, token);
  return { ...w, boss, p, upload };
}

function paymentFor(p: ReturnType<typeof preparedRun>, opts: { amountB?: string; signer?: string } = {}) {
  return parsePaymentTx({
    tx: { body: { memo: runMemo(p.run.runRoot), messages: [{
      "@type": "/cosmos.bank.v1beta1.MsgMultiSend",
      inputs: [{ address: employer.address, coins: [{ denom: "uqor", amount: "300" }] }],
      outputs: [
        { address: ada.address, coins: [{ denom: "uqor", amount: "100" }] },
        { address: bayo.address, coins: [{ denom: "uqor", amount: opts.amountB ?? "200" }] },
      ],
    }] } },
    tx_response: { txhash: "F".repeat(64), height: "10500001", code: 0, events: [{ type: "pqc_hybrid_verify", attributes: [{ key: "address", value: opts.signer ?? employer.address }, { key: "status", value: "verified" }] }] },
  });
}

describe("sign-in", () => {
  it("issues a session for a hybrid signature that matches the registered key", async () => {
    const w = world();
    w.register(ada);
    expect(await w.signIn(ada)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a classical-only signature (a stolen ECDSA key)", async () => {
    const w = world();
    w.register(ada);
    const n = (await (await w.call("POST", "/api/auth/nonce")).json()) as { nonce: string; issuedAt: string };
    const { signInStatement } = await import("@phoenix-2203/cista");
    const statement = signInStatement({ domain: "cista.test", address: ada.address, chainId: CHAIN, nonce: n.nonce, issuedAt: n.issuedAt });
    const r = await w.call("POST", "/api/auth/verify", { address: ada.address, nonce: n.nonce, issuedAt: n.issuedAt, signature: ada.sign(statement, false) });
    expect(r.status).toBe(401);
  });

  it("refuses a nonce used twice, and an old one", async () => {
    const w = world();
    w.register(ada);
    const n = (await (await w.call("POST", "/api/auth/nonce")).json()) as { nonce: string; issuedAt: string };
    const { signInStatement } = await import("@phoenix-2203/cista");
    const statement = signInStatement({ domain: "cista.test", address: ada.address, chainId: CHAIN, nonce: n.nonce, issuedAt: n.issuedAt });
    const body = { address: ada.address, nonce: n.nonce, issuedAt: n.issuedAt, signature: ada.sign(statement) };
    expect((await w.call("POST", "/api/auth/verify", body)).status).toBe(200);
    expect((await w.call("POST", "/api/auth/verify", body)).status).toBe(401);
    const m = (await (await w.call("POST", "/api/auth/nonce")).json()) as { nonce: string; issuedAt: string };
    w.tick(NONCE_TTL_MS + 1);
    const late = signInStatement({ domain: "cista.test", address: ada.address, chainId: CHAIN, nonce: m.nonce, issuedAt: m.issuedAt });
    expect((await w.call("POST", "/api/auth/verify", { address: ada.address, nonce: m.nonce, issuedAt: m.issuedAt, signature: ada.sign(late) })).status).toBe(401);
  });

  it("refuses someone signing in as another account", async () => {
    const w = world();
    w.register(ada, thief);
    const n = (await (await w.call("POST", "/api/auth/nonce")).json()) as { nonce: string; issuedAt: string };
    const { signInStatement } = await import("@phoenix-2203/cista");
    const statement = signInStatement({ domain: "cista.test", address: ada.address, chainId: CHAIN, nonce: n.nonce, issuedAt: n.issuedAt });
    const r = await w.call("POST", "/api/auth/verify", { address: ada.address, nonce: n.nonce, issuedAt: n.issuedAt, signature: thief.sign(statement) });
    expect(r.status).toBe(401);
  });
});

describe("pay runs", () => {
  it("stores a signed run and gives each employee only their own sealed payslip", async () => {
    const s = await setup();
    expect((await s.upload()).status).toBe(201);
    const token = await s.signIn(ada);
    const inbox = (await (await s.call("GET", "/api/me/payslips", undefined, token)).json()) as { payslips: { run: { runRoot: string }; envelope: string }[] };
    expect(inbox.payslips).toHaveLength(1);
    const opened = openPayslip({
      envelope: envelopeFromText(inbox.payslips[0]!.envelope),
      keys: ada.sealKeys,
      chainId: CHAIN, employer: employer.address, period: "2026-11", employee: ada.address,
      runRoot: fromHex(inbox.payslips[0]!.run.runRoot),
    });
    expect(opened.slip.slip.payout.amount).toBe(100n);
  });

  it("stores ciphertext only: the database never holds a name or an amount in the clear", async () => {
    const s = await setup();
    await s.upload();
    const rows = s.store.db.prepare("SELECT envelope FROM envelopes").all() as { envelope: Uint8Array }[];
    for (const r of rows) expect(new TextDecoder("latin1").decode(r.envelope)).not.toContain("Test Employee");
  });

  it("refuses an upload without sign-in, or for someone else's run", async () => {
    const s = await setup();
    expect((await s.call("POST", "/api/runs", { run: s.p.signed, envelopes: [] })).status).toBe(401);
    expect((await s.upload(await s.signIn(thief))).status).toBe(403);
  });

  it("refuses a run whose signature does not check out", async () => {
    const s = await setup();
    const forged = { ...s.p.signed, totalPayout: "999" };
    expect((await s.upload(s.boss, forged)).status).toBe(400);
  });

  it("refuses the wrong number of sealed payslips, duplicates and junk", async () => {
    const s = await setup();
    const one = [{ employee: ada.address, envelope: envelopeToText(s.p.envelopes[0]!.envelope) }];
    expect((await s.upload(s.boss, s.p.signed, one)).status).toBe(400);
    expect((await s.upload(s.boss, s.p.signed, [one[0]!, one[0]!])).status).toBe(400);
    expect((await s.upload(s.boss, s.p.signed, [one[0]!, { employee: bayo.address, envelope: "qoreseal:AAAA" }])).status).toBe(400);
    expect(s.store.hasRun(s.p.signed.runRoot)).toBe(false);
  });

  it("refuses the same run twice", async () => {
    const s = await setup();
    await s.upload();
    expect((await s.upload()).status).toBe(409);
  });

  it("lets only the employer list a run's sealed payslips", async () => {
    const s = await setup();
    await s.upload();
    const path = `/api/runs/${s.p.signed.runRoot}/envelopes`;
    expect((await s.call("GET", path, undefined, s.boss)).status).toBe(200);
    expect((await s.call("GET", path, undefined, await s.signIn(ada))).status).toBe(403);
  });
});

describe("payments", () => {
  it("records a payment that matches the signed run", async () => {
    const s = await setup();
    await s.upload();
    s.txs.set("F".repeat(64), paymentFor(s.p));
    const r = await s.call("POST", `/api/runs/${s.p.signed.runRoot}/payment`, { txHash: "f".repeat(64) }, s.boss);
    expect(r.status).toBe(200);
    const pub = (await (await s.call("GET", `/api/runs/${s.p.signed.runRoot}`)).json()) as { payment: { height: number } };
    expect(pub.payment.height).toBe(10500001);
  });

  it("refuses a payment that pays less, or without the employer's ML-DSA-87 signature", async () => {
    const s = await setup();
    await s.upload();
    s.txs.set("F".repeat(64), paymentFor(s.p, { amountB: "199" }));
    expect((await s.call("POST", `/api/runs/${s.p.signed.runRoot}/payment`, { txHash: "F".repeat(64) }, s.boss)).status).toBe(400);
    s.txs.set("F".repeat(64), paymentFor(s.p, { signer: thief.address }));
    expect((await s.call("POST", `/api/runs/${s.p.signed.runRoot}/payment`, { txHash: "F".repeat(64) }, s.boss)).status).toBe(400);
  });

  it("says when the chain does not know the transaction yet", async () => {
    const s = await setup();
    await s.upload();
    expect((await s.call("POST", `/api/runs/${s.p.signed.runRoot}/payment`, { txHash: "E".repeat(64) }, s.boss)).status).toBe(404);
  });
});

describe("key cards", () => {
  it("publishes a card signed with the registered ML-DSA-87 key, with its ML-KEM key", async () => {
    const w = world();
    w.register(ada);
    const token = await w.signIn(ada);
    expect((await w.call("POST", "/api/cards", { card: ada.card(), mlkemPublicKey: ada.mlkemHex() }, token)).status).toBe(200);
    const got = (await (await w.call("GET", `/api/cards/${ada.address}`)).json()) as { mlkemPublicKey: string };
    expect(got.mlkemPublicKey).toBe(ada.mlkemHex());
  });

  it("refuses someone else's card", async () => {
    const w = world();
    w.register(ada, thief);
    const token = await w.signIn(thief);
    expect((await w.call("POST", "/api/cards", { card: ada.card(), mlkemPublicKey: ada.mlkemHex() }, token)).status).toBe(403);
  });

  it("refuses a card with a swapped ML-KEM key (a server or thief trying to read payslips)", async () => {
    const w = world();
    w.register(ada, thief);
    const token = await w.signIn(ada);
    expect((await w.call("POST", "/api/cards", { card: ada.card(), mlkemPublicKey: thief.mlkemHex() }, token)).status).toBe(400);
  });

  it("refuses a card not signed with the account's registered ML-DSA-87 key", async () => {
    // Signed in as Ada with her real key, then the registry shows another key: the card must fail.
    const w2 = world();
    w2.register(ada);
    const t2 = await w2.signIn(ada);
    w2.pq.set(ada.address, thief.pqKey.publicKey);
    expect((await w2.call("POST", "/api/cards", { card: ada.card(), mlkemPublicKey: ada.mlkemHex() }, t2)).status).toBe(400);
  });
});
