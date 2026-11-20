import { describe, expect, it } from "vitest";
import { checkRunPayment, paidTo, parsePaymentTx } from "../src/payment";
import { MEMO_PREFIX } from "../src/run";
import type { SignedRun } from "../src/sign";
import { ADDR } from "./fixtures";

const ROOT = "ab".repeat(32);

const run: SignedRun = {
  chainId: "qorechain-diana",
  employer: ADDR.employer,
  period: "2026-11",
  denom: "uqor",
  totalPayout: "632100000",
  count: 2,
  runRoot: ROOT,
  signature: { signatureType: "ml-dsa-87-hybrid", classical: { keyType: "secp256k1", publicKey: "", signature: "" }, pq: { algorithmId: 1, signature: "" } },
};

/**
 * Shaped like the REST answer for a real hybrid-signed MsgSend on testnet
 * (tx EFB37D0D…7B3E, height 10,400,003): the PQC extension in the body and
 * `pqc_hybrid_verify` in the events. Addresses and amounts are test values.
 */
function restTx(opts: { messages: unknown[]; memo?: string; code?: number; verifiedBy?: string | null }) {
  const events =
    opts.verifiedBy === null
      ? []
      : [{ type: "pqc_hybrid_verify", attributes: [
          { key: "address", value: opts.verifiedBy ?? ADDR.employer },
          { key: "algorithm_id", value: "dilithium5" },
          { key: "status", value: "verified" },
        ] }];
  return {
    tx: { body: { messages: opts.messages, memo: opts.memo ?? MEMO_PREFIX + ROOT, extension_options: [{ "@type": "/qorechain.pqc.v1.PQCHybridSignature", algorithm_id: 1 }] } },
    tx_response: { txhash: "c0ffee", height: "10400003", timestamp: "2026-11-28T09:00:00Z", code: opts.code ?? 0, events },
  };
}

const multiSend = (outputs: [string, string, string?][]) => ({
  "@type": "/cosmos.bank.v1beta1.MsgMultiSend",
  inputs: [{ address: ADDR.employer, coins: [{ denom: "uqor", amount: "632100000" }] }],
  outputs: outputs.map(([address, amount, denom]) => ({ address, coins: [{ denom: denom ?? "uqor", amount }] })),
});
const send = (from: string, to: string, amount: string) => ({ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: from, to_address: to, amount: [{ denom: "uqor", amount }] });

describe("parsePaymentTx", () => {
  it("reads a multi-send as transfers", () => {
    const tx = parsePaymentTx(restTx({ messages: [multiSend([[ADDR.adaPayout, "382100000"], [ADDR.bayo, "250000000"]])] }));
    expect(tx.hash).toBe("C0FFEE");
    expect(tx.hybridSigner).toBe(ADDR.employer);
    expect(tx.transfers).toEqual([
      { from: ADDR.employer, to: ADDR.adaPayout, denom: "uqor", amount: 382_100_000n },
      { from: ADDR.employer, to: ADDR.bayo, denom: "uqor", amount: 250_000_000n },
    ]);
    expect(paidTo(tx, ADDR.employer, ADDR.bayo, "uqor")).toBe(250_000_000n);
  });

  it("reads several sends the same way", () => {
    const tx = parsePaymentTx(restTx({ messages: [send(ADDR.employer, ADDR.adaPayout, "382100000"), send(ADDR.employer, ADDR.bayo, "250000000")] }));
    expect(tx.transfers).toHaveLength(2);
    expect(tx.senders).toEqual([ADDR.employer]);
  });

  it("ignores malformed amounts", () => {
    const tx = parsePaymentTx(restTx({ messages: [send(ADDR.employer, ADDR.bayo, "1e9")] }));
    expect(tx.transfers).toEqual([]);
  });
});

describe("checkRunPayment", () => {
  const good = () => parsePaymentTx(restTx({ messages: [multiSend([[ADDR.adaPayout, "382100000"], [ADDR.bayo, "250000000"]])] }));

  it("accepts the payment of the signed run", () => {
    expect(checkRunPayment(good(), run)).toEqual({ ok: true, problems: [] });
  });

  const refuse = (what: string, tx: ReturnType<typeof parsePaymentTx>, match: RegExp) =>
    it(`refuses ${what}`, () => {
      const c = checkRunPayment(tx, run);
      expect(c.ok).toBe(false);
      expect(c.problems.join(" | ")).toMatch(match);
    });

  refuse("a failed transaction", parsePaymentTx(restTx({ code: 5, messages: [multiSend([[ADDR.adaPayout, "382100000"], [ADDR.bayo, "250000000"]])] })), /failed/);
  refuse("another run's memo", parsePaymentTx(restTx({ memo: MEMO_PREFIX + "cd".repeat(32), messages: [multiSend([[ADDR.adaPayout, "632100000"]])] })), /fingerprint/);
  refuse("a classical-only payment", parsePaymentTx(restTx({ verifiedBy: null, messages: [multiSend([[ADDR.adaPayout, "632100000"]])] })), /ML-DSA-87/);
  refuse("a signature verified for someone else", parsePaymentTx(restTx({ verifiedBy: ADDR.chidi, messages: [multiSend([[ADDR.adaPayout, "632100000"]])] })), /ML-DSA-87/);
  refuse("paying less than signed", parsePaymentTx(restTx({ messages: [multiSend([[ADDR.adaPayout, "382100000"], [ADDR.bayo, "249999999"]])] })), /signed run says/);
  refuse("money sent by someone else", parsePaymentTx(restTx({ messages: [send(ADDR.chidi, ADDR.adaPayout, "632100000")] })), /only from the employer/);
  refuse("another denom on the side", parsePaymentTx(restTx({ messages: [multiSend([[ADDR.adaPayout, "632100000"], [ADDR.bayo, "5", "ufoo"]])] })), /another denom/);
});
