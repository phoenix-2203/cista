import { generateSealKeys, parseEnvelope, recipientOf } from "@qorechain/qoreseal";
import { describe, expect, it } from "vitest";
import { fromHex, utf8 } from "../src/bytes";
import { checkDisclosure, createDisclosure } from "../src/disclose";
import { buildPayRun } from "../src/run";
import { openPayslip, pad, PAD_BLOCK, sealPayslip, SealError, unpad } from "../src/seal";
import { ADDR, sampleSlip } from "./fixtures";

const keys = { employer: generateSealKeys(), ada: generateSealKeys(), bayo: generateSealKeys(), stranger: generateSealKeys() };

function setup() {
  const ada = sampleSlip();
  const bayo = sampleSlip({
    employee: { ...ada.employee, address: ADDR.bayo, name: "Bayo Adeyemi", staffId: "ACM-0043" },
    payout: { address: ADDR.bayo, denom: "uqor", amount: 250_000_000n },
  });
  const run = buildPayRun("qorechain-diana", [
    { slip: ada, seed: fromHex("01".repeat(32)) },
    { slip: bayo, seed: fromHex("02".repeat(32)) },
  ]);
  const adaEnv = sealPayslip(run, run.slips[0]!, { employee: recipientOf(keys.ada), employer: recipientOf(keys.employer) });
  const bayoEnv = sealPayslip(run, run.slips[1]!, { employee: recipientOf(keys.bayo), employer: recipientOf(keys.employer) });
  const ctx = (employee: string) => ({ chainId: run.chainId, employer: run.employer, period: run.period, employee, runRoot: run.runRoot });
  return { run, adaEnv, bayoEnv, ctx };
}

describe("padding", () => {
  it("round-trips and rounds up to the block size", () => {
    for (const n of [0, 1, PAD_BLOCK - 4, PAD_BLOCK - 3, 5000]) {
      const data = utf8("x".repeat(n));
      const padded = pad(data);
      expect(padded.length % PAD_BLOCK).toBe(0);
      expect(unpad(padded)).toEqual(data);
    }
  });

  it("refuses junk after the data", () => {
    const padded = pad(utf8("abc"));
    padded[padded.length - 1] = 1;
    expect(() => unpad(padded)).toThrow(SealError);
  });
});

describe("sealPayslip + openPayslip", () => {
  it("lets the employee open their payslip and checks it against the run root", () => {
    const { run, adaEnv, ctx } = setup();
    const opened = openPayslip({ envelope: adaEnv, keys: keys.ada, ...ctx(ADDR.ada) });
    expect(opened.slip.slip).toEqual(run.slips[0]!.slip);
    expect(opened.slip.slipRoot).toEqual(run.slips[0]!.slipRoot);
  });

  it("lets the employer open it too", () => {
    const { adaEnv, ctx } = setup();
    expect(openPayslip({ envelope: adaEnv, keys: keys.employer, ...ctx(ADDR.ada) }).slip.slip.employee.name).toBe("Ada Obi");
  });

  it("gives the employee everything needed for a proof of pay", () => {
    const { adaEnv, ctx } = setup();
    const opened = openPayslip({ envelope: adaEnv, keys: keys.ada, ...ctx(ADDR.ada) });
    const checked = checkDisclosure(createDisclosure(opened.run, opened.slip, ["net"]));
    expect(checked.fields["net"]).toBe("38210000");
  });

  it("keeps out another employee", () => {
    const { adaEnv, ctx } = setup();
    expect(() => openPayslip({ envelope: adaEnv, keys: keys.bayo, ...ctx(ADDR.ada) })).toThrow(SealError);
  });

  it("keeps out a stranger", () => {
    const { adaEnv, ctx } = setup();
    expect(() => openPayslip({ envelope: adaEnv, keys: keys.stranger, ...ctx(ADDR.ada) })).toThrow(SealError);
  });

  it("fails if the server files Ada's envelope under Bayo", () => {
    const { adaEnv, ctx } = setup();
    expect(() => openPayslip({ envelope: adaEnv, keys: keys.employer, ...ctx(ADDR.bayo) })).toThrow(SealError);
  });

  it("fails if the envelope is moved to another run or period", () => {
    const { run, adaEnv, ctx } = setup();
    expect(() => openPayslip({ envelope: adaEnv, keys: keys.ada, ...ctx(ADDR.ada), runRoot: new Uint8Array(32) })).toThrow(SealError);
    expect(() => openPayslip({ envelope: adaEnv, keys: keys.ada, ...ctx(ADDR.ada), period: "2026-10" })).toThrow(SealError);
    expect(run.period).toBe("2026-11");
  });

  it("fails on a flipped ciphertext byte", () => {
    const { adaEnv, ctx } = setup();
    const bad = adaEnv.slice();
    bad[bad.length - 20]! ^= 1;
    expect(() => openPayslip({ envelope: bad, keys: keys.ada, ...ctx(ADDR.ada) })).toThrow(SealError);
  });

  it("uses hybrid ML-KEM-1024 + X25519, anonymous, and does not show the salary in the bytes", () => {
    const { adaEnv } = setup();
    const parsed = parseEnvelope(adaEnv);
    expect(parsed.mode).toBe("hybrid");
    expect(parsed.anonymous).toBe(true);
    expect(parsed.entries).toHaveLength(2);
    expect(new TextDecoder("latin1").decode(adaEnv)).not.toContain("Ada Obi");
  });

  it("makes envelopes the same size for different salaries", () => {
    const { adaEnv, bayoEnv } = setup();
    expect(adaEnv.length).toBe(bayoEnv.length);
  });

  it("falls back to ML-KEM-1024 only when a recipient has no X25519 key", () => {
    const { run } = setup();
    const env = sealPayslip(run, run.slips[0]!, {
      employee: { mlkemPublicKey: keys.ada.mlkemPublicKey },
      employer: recipientOf(keys.employer),
    });
    expect(parseEnvelope(env).mode).toBe("mlkem");
  });
});
