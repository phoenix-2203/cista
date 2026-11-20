import { describe, expect, it } from "vitest";
import { fromHex } from "../src/bytes";
import { createDisclosure, proofStatement } from "../src/disclose";
import { buildPayRun, statementOf } from "../src/run";
import { signedRunStatement, SignatureError, unsignedRun, verifySignedProof, verifySignedRun, type SignedProof, type SignedRun } from "../src/sign";
import { testAccount } from "./accounts";
import { sampleSlip } from "./fixtures";

const CHAIN = "qorechain-diana";
const employer = testAccount();
const ada = testAccount();
const thief = testAccount();

function signedRun() {
  const slip = sampleSlip({
    employer: { address: employer.address, name: "Acme Logistics Ltd" },
    employee: { ...sampleSlip().employee, address: ada.address },
  });
  const run = buildPayRun(CHAIN, [{ slip, seed: fromHex("07".repeat(32)) }]);
  const body = unsignedRun(run);
  const signed: SignedRun = { ...body, signature: employer.sign(CHAIN, signedRunStatement(body)) };
  return { run, signed };
}

describe("pay run signature", () => {
  it("signs exactly the run statement", () => {
    const { run, signed } = signedRun();
    expect(signedRunStatement(signed)).toBe(statementOf(run));
  });

  it("verifies against the employer's registered ML-DSA-87 key", () => {
    const { signed } = signedRun();
    expect(() => verifySignedRun(signed, employer.pqPublicKey)).not.toThrow();
  });

  it("refuses a key that is not the employer's registered one", () => {
    const { signed } = signedRun();
    expect(() => verifySignedRun(signed, thief.pqPublicKey)).toThrow(SignatureError);
  });

  it("refuses a classical-only signature (what a stolen ECDSA key can make)", () => {
    const { signed } = signedRun();
    const classicalOnly = { ...signed, signature: employer.sign(CHAIN, signedRunStatement(signed), { pq: false }) };
    expect(() => verifySignedRun(classicalOnly, employer.pqPublicKey)).toThrow(/not post-quantum signed/);
  });

  it("refuses a run whose total was raised after signing", () => {
    const { signed } = signedRun();
    expect(() => verifySignedRun({ ...signed, totalPayout: (BigInt(signed.totalPayout) + 1n).toString() }, employer.pqPublicKey)).toThrow(SignatureError);
  });

  it("refuses a run moved to another chain", () => {
    const { signed } = signedRun();
    expect(() => verifySignedRun({ ...signed, chainId: "qorechain-vladi" }, employer.pqPublicKey)).toThrow(SignatureError);
  });

  it("refuses a run signed by someone else in the employer's name", () => {
    const { signed } = signedRun();
    const forged = { ...signed, signature: thief.sign(CHAIN, signedRunStatement(signed)) };
    expect(() => verifySignedRun(forged, employer.pqPublicKey)).toThrow(SignatureError);
  });
});

describe("proof of pay signature", () => {
  const terms = { audience: "Zenith Lending, application 4471", expires: "2026-12-31T00:00:00Z" };
  const before = new Date("2026-12-01T00:00:00Z");

  function proof(signer = ada): SignedProof {
    const { run } = signedRun();
    const disclosure = createDisclosure(run, run.slips[0]!, ["net.atLeast.25000000"]);
    return { disclosure, terms, signature: signer.sign(CHAIN, proofStatement(disclosure, terms)) };
  }

  it("verifies when the employee signs it", () => {
    const checked = verifySignedProof(proof(), ada.pqPublicKey, before);
    expect(checked.employee).toBe(ada.address);
    expect(checked.fields["net.atLeast.25000000"]).toBe("yes");
  });

  it("refuses a proof signed by someone other than the employee", () => {
    expect(() => verifySignedProof(proof(thief), thief.pqPublicKey, before)).toThrow(SignatureError);
  });

  it("refuses a proof handed to a different lender", () => {
    const p = proof();
    expect(() => verifySignedProof({ ...p, terms: { ...terms, audience: "Another Bank" } }, ada.pqPublicKey, before)).toThrow(SignatureError);
  });

  it("refuses an expiry pushed back after signing", () => {
    const p = proof();
    expect(() => verifySignedProof({ ...p, terms: { ...terms, expires: "2030-01-01T00:00:00Z" } }, ada.pqPublicKey, before)).toThrow(SignatureError);
  });

  it("refuses an expired proof", () => {
    expect(() => verifySignedProof(proof(), ada.pqPublicKey, new Date("2027-01-01T00:00:00Z"))).toThrow(/expired/);
  });

  it("refuses a field quietly added after signing", () => {
    const { run } = signedRun();
    const p = proof();
    const wider = createDisclosure(run, run.slips[0]!, ["net.atLeast.25000000", "net"]);
    expect(() => verifySignedProof({ ...p, disclosure: wider }, ada.pqPublicKey, before)).toThrow(SignatureError);
  });
});
