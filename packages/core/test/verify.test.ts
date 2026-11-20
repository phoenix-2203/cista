import { describe, expect, it } from "vitest";
import { fromHex } from "../src/bytes";
import { createDisclosure, proofStatement } from "../src/disclose";
import { parsePaymentTx, type PaymentTx } from "../src/payment";
import { buildPayRun, runMemo } from "../src/run";
import { signedRunStatement, unsignedRun, type SignedRun } from "../src/sign";
import { decodeProofBundle, encodeProofBundle, verifyProofBundle, type ChainReader, type ProofBundle, type RegisteredKey } from "../src/verify";
import { testAccount } from "./accounts";
import { sampleSlip } from "./fixtures";

const CHAIN = "qorechain-diana";
const NOW = new Date("2026-12-01T00:00:00Z");
const employer = testAccount();
const ada = testAccount();
const bayo = testAccount();
const thief = testAccount();

function world(opts: { reveal?: string[]; paid?: bigint } = {}) {
  const base = sampleSlip();
  const adaSlip = sampleSlip({
    employer: { address: employer.address, name: "Acme Logistics Ltd" },
    employee: { ...base.employee, address: ada.address },
    payout: { ...base.payout, address: ada.address },
  });
  const bayoSlip = sampleSlip({
    employer: { address: employer.address, name: "Acme Logistics Ltd" },
    employee: { ...base.employee, address: bayo.address, name: "Bayo Adeyemi" },
    payout: { address: bayo.address, denom: "uqor", amount: 250_000_000n },
  });
  const run = buildPayRun(CHAIN, [
    { slip: adaSlip, seed: fromHex("01".repeat(32)) },
    { slip: bayoSlip, seed: fromHex("02".repeat(32)) },
  ]);
  const body = unsignedRun(run);
  const signedRun: SignedRun = { ...body, signature: employer.sign(CHAIN, signedRunStatement(body)) };

  const tx = parsePaymentTx({
    tx: { body: { memo: runMemo(run.runRoot), messages: [{
      "@type": "/cosmos.bank.v1beta1.MsgMultiSend",
      inputs: [{ address: employer.address, coins: [{ denom: "uqor", amount: run.totalPayout.toString() }] }],
      outputs: [
        { address: ada.address, coins: [{ denom: "uqor", amount: (opts.paid ?? 382_100_000n).toString() }] },
        { address: bayo.address, coins: [{ denom: "uqor", amount: (run.totalPayout - (opts.paid ?? 382_100_000n)).toString() }] },
      ],
    }] } },
    tx_response: { txhash: "aa11", height: "10500000", code: 0, events: [{ type: "pqc_hybrid_verify", attributes: [{ key: "address", value: employer.address }, { key: "status", value: "verified" }] }] },
  });

  const disclosure = createDisclosure(run, run.slips[0]!, opts.reveal ?? ["employer.name", "net.atLeast.25000000"]);
  const terms = { audience: "Zenith Lending, application 4471", expires: "2026-12-31T00:00:00Z" };
  const bundle: ProofBundle = {
    v: 1,
    proof: { disclosure, terms, signature: ada.sign(CHAIN, proofStatement(disclosure, terms)) },
    run: signedRun,
    paymentTx: "AA11",
  };

  const keys = new Map<string, RegisteredKey>([
    [employer.address, { publicKey: employer.pqPublicKey, possessionProven: true }],
    [ada.address, { publicKey: ada.pqPublicKey, possessionProven: true }],
    [bayo.address, { publicKey: bayo.pqPublicKey, possessionProven: true }],
  ]);
  const txs = new Map<string, PaymentTx>([["AA11", tx]]);
  const chain: ChainReader = {
    pqKey: async (a) => keys.get(a) ?? null,
    paymentTx: async (h) => txs.get(h.toUpperCase()) ?? null,
  };
  return { run, bundle, chain, keys, txs };
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("verifyProofBundle", () => {
  it("passes every check for an honest proof", async () => {
    const { bundle, chain } = world();
    const v = await verifyProofBundle(bundle, chain, NOW);
    expect(v.ok).toBe(true);
    expect(v.checks.map((c) => [c.id, c.ok])).toEqual([["fields", true], ["employee", true], ["employer", true], ["same-run", true], ["payment", true]]);
    expect(v.fields).toEqual({ "employer.name": "Acme Logistics Ltd", "employee.address": ada.address, "net.atLeast.25000000": "yes" });
    expect(v.employee).toBe(ada.address);
  });

  it("checks the payout really landed when it is shown", async () => {
    const { bundle, chain } = world({ reveal: ["payout.address", "payout.amount"] });
    const v = await verifyProofBundle(bundle, chain, NOW);
    expect(v.ok).toBe(true);
    expect(v.checks.at(-1)).toMatchObject({ id: "payout", ok: true });
  });

  it("catches a payslip that claims more than the chain paid", async () => {
    const { bundle, chain } = world({ reveal: ["payout.address", "payout.amount"], paid: 300_000_000n });
    const v = await verifyProofBundle(bundle, chain, NOW);
    expect(v.ok).toBe(false);
    expect(v.checks.at(-1)).toMatchObject({ id: "payout", ok: false });
  });

  const fails = (what: string, id: string, edit: (w: ReturnType<typeof world>) => void, now = NOW) =>
    it(`fails at "${id}" for ${what}`, async () => {
      const w = world();
      edit(w);
      const v = await verifyProofBundle(w.bundle, w.chain, now);
      expect(v.ok).toBe(false);
      expect(v.fields).toBeUndefined();
      expect(v.checks.find((c) => !c.ok)?.id).toBe(id);
    });

  fails("a raised net pay", "fields", (w) => {
    w.bundle = clone(w.bundle);
    w.bundle.proof.disclosure.fields.find((f) => f.name === "net.atLeast.25000000")!.name = "net.atLeast.50000000";
  });
  fails("Bayo passing off Ada's proof as his", "employee", (w) => {
    const d = w.bundle.proof.disclosure;
    w.bundle = { ...w.bundle, proof: { ...w.bundle.proof, signature: bayo.sign(CHAIN, proofStatement(d, w.bundle.proof.terms)) } };
  });
  fails("an employee with no registered key", "employee", (w) => w.keys.delete(ada.address));
  fails("an expired proof", "employee", () => {}, new Date("2027-02-01T00:00:00Z"));
  fails("a run signed by a thief", "employer", (w) => {
    w.bundle = { ...w.bundle, run: { ...w.bundle.run, signature: thief.sign(CHAIN, signedRunStatement(w.bundle.run)) } };
  });
  fails("an employer key swapped in the registry", "employer", (w) => w.keys.set(employer.address, { publicKey: thief.pqPublicKey, possessionProven: true }));
  fails("a proof paired with another signed run", "same-run", (w) => {
    const other = { ...w.bundle.run, runRoot: "cd".repeat(32) };
    w.bundle = { ...w.bundle, run: { ...other, signature: employer.sign(CHAIN, signedRunStatement(other)) } };
  });
  fails("an unknown payment transaction", "payment", (w) => w.txs.clear());
  fails("a payment without the employer's ML-DSA-87 signature", "payment", (w) => w.txs.set("AA11", { ...w.txs.get("AA11")!, hybridSigner: undefined }));

  it("refuses something that is not a bundle", async () => {
    const { chain } = world();
    expect((await verifyProofBundle({} as ProofBundle, chain, NOW)).ok).toBe(false);
  });
});

describe("proof bundle text", () => {
  it("round-trips through one line of text", () => {
    const { bundle } = world();
    const text = encodeProofBundle(bundle);
    expect(text).toMatch(/^cista-proof:[A-Za-z0-9_-]+$/);
    expect(decodeProofBundle(text)).toEqual(clone(bundle));
  });

  it("refuses damaged text", () => {
    expect(() => decodeProofBundle("hello")).toThrow();
    expect(() => decodeProofBundle("cista-proof:!!!")).toThrow(/damaged/);
  });
});
