import {
  buildPayRun,
  createDisclosure,
  fromHex,
  merkleProof,
  merkleRoot,
  fieldCommitment,
  fieldSalt,
  rootFromProof,
  signedRunStatement,
  toHex as hex,
  unsignedRun,
  type Payslip,
  type SignedRun,
} from "@phoenix-2203/cista";
import { addressFromPublicKey, classicalKeyFromPrivate, messagePqSignBytes, pqKeyFromSeed, signMessage } from "@qorechain/qoresign";
import { beforeEach, describe, expect, it } from "vitest";
import { RevertError, TestChain, toHex } from "./evm";

const CHAIN = "qorechain-diana";
const FUSD = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function account() {
  const classicalKey = classicalKeyFromPrivate(rnd(32), "secp256k1");
  const pqKey = pqKeyFromSeed(rnd(32));
  const addr = addressFromPublicKey(classicalKey.publicKey, "secp256k1");
  return {
    address: addr.bech32,
    evm: toHex(addr.bytes).toLowerCase() as `0x${string}`,
    pqKey,
    sign: (text: string) => signMessage({ chainId: CHAIN, signer: addr.bech32, data: text, classicalKey, pqKey }),
  };
}

const employer = account();
const ada = account();
const bayo = account();
const thief = account();

const slip = (who: ReturnType<typeof account>, net: bigint): Payslip => ({
  version: 1,
  employer: { address: employer.address, name: "Acme Logistics Ltd" },
  employee: { address: who.address, name: "Someone", staffId: "S-1", role: "Analyst", employedSince: "2025-03-01" },
  period: "2026-11",
  payDate: "2026-11-28",
  currency: "USD",
  earnings: [{ code: "basic", label: "Basic salary", amount: net }],
  deductions: [],
  employerContributions: [],
  payout: { address: who.address, denom: FUSD, amount: net * 10_000n },
  thresholds: [100_000n, 250_000n, 300_000n],
});

function signedRun() {
  const run = buildPayRun(CHAIN, [
    { slip: slip(ada, 279_050n), seed: fromHex("01".repeat(32)) },
    { slip: slip(bayo, 150_000n), seed: fromHex("02".repeat(32)) },
  ]);
  const body = unsignedRun(run);
  const statement = signedRunStatement(body);
  const signed: SignedRun = { ...body, signature: employer.sign(statement) };
  const pqSig = Uint8Array.from(atob(signed.signature.pq!.signature), (c) => c.charCodeAt(0));
  return { run, signed, statement, pqSig, message: messagePqSignBytes(CHAIN, statement) };
}

const header = (s: SignedRun) => ({
  chainId: s.chainId,
  employer: s.employer,
  period: s.period,
  count: BigInt(s.count),
  totalPayout: BigInt(s.totalPayout),
  denom: s.denom,
  runRoot: `0x${s.runRoot}` as const,
});

const asFields = (d: ReturnType<typeof createDisclosure>) =>
  d.fields.map((f) => ({ name: f.name, value: f.value, salt: `0x${f.salt}`, index: BigInt(f.index), siblings: f.siblings.map((x) => `0x${x}`) }));

async function expectRevert(p: Promise<unknown>, error: string) {
  const { VERIFIER_ABI } = await import("./evm");
  const { decodeErrorResult } = await import("viem");
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(RevertError);
    expect(decodeErrorResult({ abi: VERIFIER_ABI, data: (e as RevertError).data }).errorName).toBe(error);
    return;
  }
  throw new Error(`expected ${error}`);
}

let chain: TestChain;
beforeEach(async () => {
  chain = await TestChain.create();
  await chain.registerKey(employer.evm, employer.pqKey.publicKey);
});

describe("CistaVerifier: the run statement", () => {
  it("rebuilds exactly the text the employer signed in QoreX", async () => {
    const { signed, statement, message } = signedRun();
    const { result } = await chain.call<`0x${string}`>("runStatement", [header(signed)]);
    expect(Buffer.from(result.slice(2), "hex").toString("utf8")).toBe(statement);
    const bytes = await chain.call<`0x${string}`>("signedBytes", [header(signed)]);
    expect(bytes.result).toBe(toHex(message));
  });

  it("accepts the employer's ML-DSA-87 signature through the precompiles, and names the employer", async () => {
    const { signed, pqSig, message } = signedRun();
    await chain.allowSignature(employer.pqKey.publicKey, pqSig, message);
    const { result } = await chain.call<string>("verifyRun", [header(signed), toHex(pqSig)]);
    expect(result.toLowerCase()).toBe(employer.evm);
  });

  it("refuses a run whose total was raised after signing", async () => {
    const { signed, pqSig, message } = signedRun();
    await chain.allowSignature(employer.pqKey.publicKey, pqSig, message);
    await expectRevert(chain.call("verifyRun", [{ ...header(signed), totalPayout: BigInt(signed.totalPayout) + 1n }, toHex(pqSig)]), "BadSignature");
  });

  it("refuses a run in the name of an employer with no registered key", async () => {
    const { signed, pqSig } = signedRun();
    await expectRevert(chain.call("verifyRun", [{ ...header(signed), employer: thief.address }, toHex(pqSig)]), "NoRegisteredKey");
  });

  it("refuses when the PQC precompiles aren't there, instead of passing", async () => {
    const { signed, pqSig, message } = signedRun();
    await chain.allowSignature(employer.pqKey.publicKey, pqSig, message);
    await chain.dropPrecompiles();
    await expectRevert(chain.call("verifyRun", [header(signed), toHex(pqSig)]), "PrecompileInactive");
  });
});

describe("CistaVerifier: payslip fields", () => {
  it("matches the TypeScript commitments and Merkle roots", async () => {
    const { run } = signedRun();
    const s = run.slips[0]!;
    const f = s.fields.find((x) => x.name === "net")!;
    const salt = fieldSalt(s.seed, "net");
    const { result } = await chain.call<`0x${string}`>("fieldCommitment", ["net", f.value, toHex(salt)]);
    expect(result).toBe(`0x${hex(fieldCommitment(f, salt))}`);
    const i = s.fields.indexOf(f);
    const proof = merkleProof(s.commitments, i);
    const root = await chain.call<`0x${string}`>("rootFromProof", [toHex(s.commitments[i]!), BigInt(i), proof.siblings.map(toHex)]);
    expect(root.result).toBe(toHex(rootFromProof(s.commitments[i]!, proof)));
    expect(toHex(merkleRoot(s.commitments))).toBe(root.result);
  });

  it("verifies a proof of income above $2,500 and names the employer and the employee", async () => {
    const { run, signed, pqSig, message } = signedRun();
    await chain.allowSignature(employer.pqKey.publicKey, pqSig, message);
    const d = createDisclosure(run, run.slips[0]!, ["employer.name", "net.atLeast.250000"]);
    const { result, gas } = await chain.call<[string, string]>("verifyFields", [header(signed), toHex(pqSig), BigInt(d.slipIndex), d.slipSiblings.map((x) => `0x${x}`), asFields(d)]);
    expect(result[0].toLowerCase()).toBe(employer.evm);
    expect(result[1].toLowerCase()).toBe(ada.evm);
    // The mock precompiles are cheap; the real ML-DSA-87 check adds about 312k gas.
    expect(gas).toBeLessThan(400_000n);
  });

  it("verifies \"earned at least $25,000 this year\" from a payslip with year-to-date totals", async () => {
    const withYear = (who: ReturnType<typeof account>, net: bigint): Payslip => ({
      ...slip(who, net),
      payFrequency: "monthly",
      yearToDate: { gross: net * 11n, deductions: 0n, thresholds: [2_500_000n, 5_000_000n] },
    });
    const run = buildPayRun(CHAIN, [
      { slip: withYear(ada, 279_050n), seed: fromHex("03".repeat(32)) },
      { slip: withYear(bayo, 150_000n), seed: fromHex("04".repeat(32)) },
    ]);
    const body = unsignedRun(run);
    const statement = signedRunStatement(body);
    const signed: SignedRun = { ...body, signature: employer.sign(statement) };
    const pqSig = Uint8Array.from(atob(signed.signature.pq!.signature), (c) => c.charCodeAt(0));
    await chain.allowSignature(employer.pqKey.publicKey, pqSig, messagePqSignBytes(CHAIN, statement));
    const d = createDisclosure(run, run.slips[0]!, ["employer.name", "payFrequency", "ytd.net.atLeast.2500000"]);
    expect(d.fields.find((f) => f.name === "ytd.net.atLeast.2500000")?.value).toBe("yes");
    const { result } = await chain.call<[string, string]>("verifyFields", [header(signed), toHex(pqSig), BigInt(d.slipIndex), d.slipSiblings.map((x) => `0x${x}`), asFields(d)]);
    expect(result[1].toLowerCase()).toBe(ada.evm);
    // Flipping Bayo's "no" for $25,000 to "yes" is refused.
    const b = createDisclosure(run, run.slips[1]!, ["ytd.net.atLeast.2500000"]);
    const flipped = asFields(b).map((f) => (f.name === "ytd.net.atLeast.2500000" ? { ...f, value: "yes" } : f));
    expect(b.fields.find((f) => f.name === "ytd.net.atLeast.2500000")?.value).toBe("no");
    await expectRevert(chain.call("verifyFields", [header(signed), toHex(pqSig), BigInt(b.slipIndex), b.slipSiblings.map((x) => `0x${x}`), flipped]), "BadProof");
  });

  const tampered = (what: string, edit: (fields: ReturnType<typeof asFields>) => void, error = "BadProof") =>
    it(`refuses ${what}`, async () => {
      const { run, signed, pqSig, message } = signedRun();
      await chain.allowSignature(employer.pqKey.publicKey, pqSig, message);
      const d = createDisclosure(run, run.slips[0]!, ["net.atLeast.250000", "net"]);
      const fields = asFields(d);
      edit(fields);
      await expectRevert(chain.call("verifyFields", [header(signed), toHex(pqSig), BigInt(d.slipIndex), d.slipSiblings.map((x) => `0x${x}`), fields]), error);
    });

  tampered("a raised net pay", (f) => (f.find((x) => x.name === "net")!.value = "999999"));
  tampered("a band flipped from no to yes", (f) => (f.find((x) => x.name === "net.atLeast.250000")!.name = "net.atLeast.300000"));
  tampered("a field from another payslip", (f) => {
    const { run } = signedRun();
    const other = createDisclosure(run, run.slips[1]!, ["net"]);
    const net = asFields(other).find((x) => x.name === "net")!;
    Object.assign(f.find((x) => x.name === "net")!, net);
  });
  tampered("a proof with no employee address", (f) => f.splice(f.findIndex((x) => x.name === "employee.address"), 1), "NoEmployeeField");
  tampered("an index that doesn't fit the proof", (f) => (f[0]!.index = 1n << 20n));

  it("refuses Bayo's payslip passed off at Ada's position in the run", async () => {
    const { run, signed, pqSig, message } = signedRun();
    await chain.allowSignature(employer.pqKey.publicKey, pqSig, message);
    const d = createDisclosure(run, run.slips[1]!, ["net"]);
    await expectRevert(chain.call("verifyFields", [header(signed), toHex(pqSig), 0n, d.slipSiblings.map((x) => `0x${x}`), asFields(d)]), "BadProof");
  });
});

describe("CistaVerifier: qor1 addresses", () => {
  it("parses a qor1 address to its 20 bytes", async () => {
    const { result } = await chain.call<string>("parseQorAddress", [ada.address]);
    expect(result.toLowerCase()).toBe(ada.evm);
  });

  it("refuses a bad checksum, another prefix and odd lengths", async () => {
    const broken = ada.address.slice(0, -1) + (ada.address.endsWith("q") ? "p" : "q");
    for (const bad of [broken, ada.address.replace("qor1", "cos1"), ada.address.slice(0, 41), ada.address + "q", ada.address.toUpperCase()]) {
      await expectRevert(chain.call("parseQorAddress", [bad]), "BadAddress");
    }
  });
});

describe("CistaVerifier: the web app's call", () => {
  it("accepts the exact call the proof page sends, built from a proof bundle", async () => {
    const { verifyFieldsCall } = await import("../../../apps/web/src/lib/onchain");
    const { decodeFunctionResult } = await import("viem");
    const { VERIFIER_ABI } = await import("./evm");
    const { run, signed, pqSig, message } = signedRun();
    await chain.allowSignature(employer.pqKey.publicKey, pqSig, message);
    const disclosure = createDisclosure(run, run.slips[1]!, ["employer.name", "net.atLeast.100000"]);
    const bundle = { v: 1 as const, proof: { disclosure, terms: { audience: "Bank", expires: "2030-01-01T00:00:00Z" }, signature: signed.signature }, run: signed, paymentTx: "AB".repeat(32) };
    const { ret } = await chain.callRaw(verifyFieldsCall(bundle));
    const [emp, who] = decodeFunctionResult({ abi: VERIFIER_ABI, functionName: "verifyFields", data: ret }) as unknown as [string, string];
    expect(emp.toLowerCase()).toBe(employer.evm);
    expect(who.toLowerCase()).toBe(bayo.evm);
  });
});
