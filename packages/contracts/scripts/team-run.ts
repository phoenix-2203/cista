/**
 * A live pay run for a team of three, end to end, from the throwaway testnet
 * account in .env.seed:
 *
 *   1. make three fresh employee accounts and Cista sealing keys;
 *   2. build their payslips (with pay frequency and the year so far), sign the
 *      run with the employer's ML-DSA-87 key, and seal each payslip to its
 *      employee and to the employer;
 *   3. pay all three in ONE hybrid-signed MsgMultiSend carrying the run root;
 *   4. read the transaction back and check it pays exactly the signed run;
 *   5. each employee opens only their own payslip; nobody opens anyone else's;
 *   6. the employer reopens its own copies (how "Start from an earlier run" works);
 *   7. CistaVerifier checks an "earned this year" proof for each employee on chain.
 *
 * Pays tiny amounts of test QOR (0.01, 0.02 and 0.03). Results go to
 * ../../drill-results/team-run.{json,md} (git-ignored, committed separately).
 *
 *   pnpm --filter @cista/contracts team:run
 */
import {
  buildPayRun,
  checkRunPayment,
  createDisclosure,
  openPayslip,
  parsePaymentTx,
  randomSeed,
  runMemo,
  sealPayslip,
  signedRunStatement,
  unsignedRun,
  type Payslip,
  type SignedRun,
} from "@phoenix-2203/cista";
import { qorechainTestnet } from "@qorechain/evm";
import { generateSealKeys, recipientOf } from "@qorechain/qoreseal";
import { classicalKeyFromPrivate, signMessage } from "@qorechain/qoresign";
import { EthNativeSigner, deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, hexToBytes, http, type Hex } from "viem";
import deployment from "../deployments/testnet.json" with { type: "json" };
import { CISTA_VERIFIER_ABI } from "../src/artifact";
import { CHAIN_ID, NATIVE_FEE, REST, rest, transport } from "./lib/testnet";

const OUT = "../../drill-results";
const mnemonic = (process.env.E2E_MNEMONIC ?? process.env.SEED_MNEMONIC)?.trim();
if (!mnemonic) throw new Error("Put the THROWAWAY testnet phrase in packages/contracts/.env.seed as E2E_MNEMONIC=\"…\".");
const employer = await deriveUnifiedAccount(mnemonic);
const bal = BigInt((await rest<{ balance: { amount: string } }>(`/cosmos/bank/v1beta1/balances/${employer.cosmos}/by_denom?denom=uqor`)).balance?.amount ?? "0");
if (bal > 50_000_000n) throw new Error("This account holds more than 50 QOR. Use a throwaway testnet account.");
if (bal < 300_000n) throw new Error(`Fund ${employer.cosmos} with at least 0.3 test QOR first.`);

type Step = { step: string; ok: boolean; detail: string };
const steps: Step[] = [];
const log = (step: string, ok: boolean, detail: string) => {
  steps.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}\n      ${detail}`);
};

// 1. Three employees with fresh accounts and sealing keys.
const team = await Promise.all(
  ["Ada Obi", "Bayo Adeyemi", "Chidi Okeke"].map(async (name, i) => ({
    name,
    account: await deriveUnifiedAccount(generateMnemonic(256)),
    keys: generateSealKeys(),
    uqor: BigInt(10_000 * (i + 1)),
    netCents: BigInt(250_000 + 50_000 * i),
  })),
);
const employerKeys = generateSealKeys();
console.log(`Team pay run on ${CHAIN_ID}\n  employer: ${employer.cosmos}\n  team: ${team.map((t) => t.account.cosmos).join(", ")}\n`);

// 2. Payslips, the signed run, the sealed envelopes.
const period = new Date().toISOString().slice(0, 7);
const payDate = new Date().toISOString().slice(0, 10);
const slips: Payslip[] = team.map((t, i) => {
  const tax = 40_000n;
  const gross = t.netCents + tax;
  return {
    version: 1,
    employer: { address: employer.cosmos, name: "Cista Team Run Ltd" },
    employee: { address: t.account.cosmos, name: t.name, staffId: `CTR-00${i + 1}`, role: "Analyst", employedSince: "2025-01-06" },
    period,
    payDate,
    currency: "USD",
    earnings: [{ code: "basic", label: "Basic salary", amount: gross }],
    deductions: [{ code: "tax", label: "Income tax", amount: tax }],
    employerContributions: [{ code: "pension", label: "Employer pension contribution", amount: 20_000n }],
    payout: { address: t.account.cosmos, denom: "uqor", amount: t.uqor },
    thresholds: [100_000n, 250_000n, 300_000n, 350_000n],
    payFrequency: "monthly",
    // As if paid the same each month this year.
    yearToDate: { gross: gross * 11n, deductions: tax * 11n, thresholds: [2_500_000n, 3_000_000n, 3_500_000n] },
  };
});
const run = buildPayRun(CHAIN_ID, slips.map((slip) => ({ slip, seed: randomSeed() })));
const body = unsignedRun(run);
const classical = classicalKeyFromPrivate(hexToBytes(employer.privateKey as Hex), "eth_secp256k1");
const signed: SignedRun = { ...body, signature: signMessage({ chainId: CHAIN_ID, signer: employer.cosmos, data: signedRunStatement(body), classicalKey: classical, pqKey: employer.pqc }) };
const envelopes = run.slips.map((b, i) => sealPayslip(run, b, { employee: recipientOf(team[i]!.keys), employer: recipientOf(employerKeys) }));
log("Build, sign and seal", true, `${run.slips.length} payslips, run root ${signed.runRoot}, total ${signed.totalPayout} uqor, each sealed to its employee and the employer`);

// 3. One transaction pays everyone.
const a = await rest<{ account: { account_number: string; sequence: string } }>(`/cosmos/auth/v1beta1/accounts/${employer.cosmos}`);
const pay = (await new EthNativeSigner(employer, { signMode: "hybrid", rest: REST }).signAndBroadcast(transport, {
  chainId: CHAIN_ID,
  accountNumber: BigInt(a.account.account_number),
  sequence: BigInt(a.account.sequence),
  fee: { ...NATIVE_FEE, gas: String(150_000 + 40_000 * team.length + 300_000) },
  messages: [
    {
      typeUrl: "/cosmos.bank.v1beta1.MsgMultiSend",
      value: {
        inputs: [{ address: employer.cosmos, coins: [{ denom: "uqor", amount: signed.totalPayout }] }],
        outputs: run.slips.map((b) => ({ address: b.slip.payout.address, coins: [{ denom: "uqor", amount: b.slip.payout.amount.toString() }] })),
      },
    },
  ] as never,
  memo: runMemo(run.runRoot),
})) as { code: number; transactionHash: string; rawLog?: string };
if (pay.code !== 0) throw new Error(`The payment failed (code ${pay.code}): ${pay.rawLog}`);
const txHash = pay.transactionHash.toUpperCase();
log("Pay the whole team in one transaction", true, `MsgMultiSend with ${team.length} outputs, hybrid-signed, tx ${txHash}`);

// 4. The chain's record of it pays exactly the signed run.
const txBody = await rest<unknown>(`/cosmos/tx/v1beta1/txs/${txHash}`);
const tx = parsePaymentTx(txBody);
const check = checkRunPayment(tx, signed);
const height = (txBody as { tx_response: { height: string } }).tx_response.height;
log("The chain's record pays exactly the signed run", check.ok, check.ok ? `block ${height}; memo carries the run root; employer's ML-DSA-87 signature verified by the chain; ${tx.transfers.length} transfers totalling ${signed.totalPayout} uqor` : check.problems.join("; "));
for (const [i, t] of team.entries()) {
  const got = BigInt((await rest<{ balance: { amount: string } }>(`/cosmos/bank/v1beta1/balances/${t.account.cosmos}/by_denom?denom=uqor`)).balance?.amount ?? "0");
  log(`${t.name} was paid`, got === t.uqor, `${got} uqor at ${t.account.cosmos} (expected ${slips[i]!.payout.amount})`);
}

// 5. Each employee opens their own payslip, and only theirs.
const ctx = (employee: string) => ({ chainId: run.chainId, employer: run.employer, period: run.period, employee, runRoot: run.runRoot });
for (const [i, t] of team.entries()) {
  const opened = openPayslip({ envelope: envelopes[i]!, keys: t.keys, ...ctx(t.account.cosmos) });
  const net = opened.slip.fields.find((f) => f.name === "net")?.value;
  const ytd = opened.slip.fields.find((f) => f.name === "ytd.net")?.value;
  log(`${t.name} opens their payslip`, net === t.netCents.toString(), `net ${net} cents, year to date ${ytd} cents, frequency ${opened.slip.slip.payFrequency}`);
  const other = (i + 1) % team.length;
  let refused = false;
  try {
    openPayslip({ envelope: envelopes[other]!, keys: t.keys, ...ctx(team[other]!.account.cosmos) });
  } catch {
    refused = true;
  }
  log(`${t.name} can't open ${team[other]!.name}'s payslip`, refused, refused ? "refused" : "OPENED: this must never happen");
}

// 6. The employer reopens its own copies, as "Start from an earlier run" does.
const copies = envelopes.map((e, i) => openPayslip({ envelope: e, keys: employerKeys, ...ctx(team[i]!.account.cosmos) }).slip.slip);
log("The employer reopens its own copies", copies.every((c, i) => c.employee.name === team[i]!.name), copies.map((c) => `${c.employee.name} ${c.payFrequency}`).join(", "));

// 7. CistaVerifier checks an "earned this year" proof for each employee, on chain.
const pub = createPublicClient({ chain: qorechainTestnet, transport: http() });
const pq = signed.signature.pq!;
const header = { chainId: signed.chainId, employer: signed.employer, period: signed.period, count: BigInt(signed.count), totalPayout: BigInt(signed.totalPayout), denom: signed.denom, runRoot: `0x${signed.runRoot}` as Hex };
for (const [i, t] of team.entries()) {
  const d = createDisclosure(run, run.slips[i]!, ["employer.name", "period", "ytd.net.atLeast.2500000"]);
  try {
    const [emp, who] = (await pub.readContract({
      address: deployment.CistaVerifier as Hex,
      abi: CISTA_VERIFIER_ABI,
      functionName: "verifyFields",
      args: [
        header,
        `0x${Buffer.from(pq.signature, "base64").toString("hex")}` as Hex,
        BigInt(d.slipIndex),
        d.slipSiblings.map((s) => `0x${s}` as Hex),
        d.fields.map((f) => ({ name: f.name, value: f.value, salt: `0x${f.salt}` as Hex, index: BigInt(f.index), siblings: f.siblings.map((s) => `0x${s}` as Hex) })),
      ],
    })) as readonly [string, string];
    log(`On chain: ${t.name} earned at least $25,000 this year`, emp === employer.cosmos && who === t.account.cosmos, `CistaVerifier ${deployment.CistaVerifier} returned employer ${emp}, employee ${who}`);
  } catch (e) {
    log(`On chain: ${t.name} earned at least $25,000 this year`, false, (e as Error).message.split("\n")[0]!);
  }
}

// Results.
const passed = steps.filter((s) => s.ok).length;
console.log(`\n${passed} of ${steps.length} checks passed`);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/team-run.json`, JSON.stringify({ at: new Date().toISOString(), chainId: CHAIN_ID, employer: employer.cosmos, team: team.map((t) => t.account.cosmos), runRoot: signed.runRoot, txHash, height, steps }, null, 2) + "\n");
writeFileSync(
  `${OUT}/team-run.md`,
  [
    `# Team pay run, ${new Date().toISOString().slice(0, 10)}`,
    "",
    `One hybrid-signed \`MsgMultiSend\` paid a team of ${team.length} on ${CHAIN_ID}: tx [\`${txHash}\`](https://explore.qore.network/tx/${txHash}), block ${height}, run root \`${signed.runRoot}\`.`,
    "",
    `**${passed} of ${steps.length} checks passed.**`,
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...steps.map((s) => `| ${s.step} | ${s.ok ? "pass" : "FAIL"} | ${s.detail.replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n"),
);
console.log(`Wrote ${OUT}/team-run.md`);
if (passed !== steps.length) process.exit(1);
