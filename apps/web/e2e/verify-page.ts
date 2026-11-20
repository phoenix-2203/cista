/**
 * End-to-end check of the verify page in a real browser (Chromium via
 * Playwright), with the chain answered by fixtures: an honest proof must show
 * "checks out" with only the chosen fields, and a tampered one must be refused.
 *
 *   pnpm --filter @cista/web build && pnpm --filter @cista/web preview &
 *   pnpm --filter @cista/web e2e:verify            (BASE_URL, default http://127.0.0.1:4173)
 */
import {
  buildPayRun, createDisclosure, encodeProofBundle, fromHex, proofStatement, runMemo, signedRunStatement, unsignedRun, type ProofBundle,
} from "@phoenix-2203/cista";
import { addressFromPublicKey, classicalKeyFromPrivate, pqKeyFromSeed, signMessage } from "@qorechain/qoresign";
import { createRequire } from "node:module";

// Playwright with its Chromium is expected on the machine (npm i -g playwright && npx playwright install chromium);
// it is loaded through require so a global install works.
const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const CHAIN = "qorechain-diana";
const FUSD = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

function account() {
  const classicalKey = classicalKeyFromPrivate(rnd(32), "secp256k1");
  const pqKey = pqKeyFromSeed(rnd(32));
  const address = addressFromPublicKey(classicalKey.publicKey, "secp256k1").bech32;
  return { address, pqKey, sign: (t: string) => signMessage({ chainId: CHAIN, signer: address, data: t, classicalKey, pqKey }) };
}

const employer = account();
const ada = account();
const slip = {
  version: 1 as const,
  employer: { address: employer.address, name: "Acme Logistics Ltd" },
  employee: { address: ada.address, name: "Ada Obi", staffId: "ACM-0042", role: "Operations Analyst", employedSince: "2025-03-01" },
  period: "2026-11", payDate: "2026-11-28", currency: "USD",
  earnings: [{ code: "basic", label: "Basic salary", amount: 345_000n }],
  deductions: [{ code: "tax", label: "Income tax", amount: 65_950n }],
  employerContributions: [],
  payout: { address: ada.address, denom: FUSD, amount: 2_790_500_000n },
  thresholds: [250_000n, 300_000n],
};
const run = buildPayRun(CHAIN, [{ slip, seed: fromHex("01".repeat(32)) }]);
const body = unsignedRun(run);
const signedRun = { ...body, signature: employer.sign(signedRunStatement(body)) };
const disclosure = createDisclosure(run, run.slips[0]!, ["employer.name", "period", "net.atLeast.250000", "net.atLeast.300000"]);
const terms = { audience: "Zenith Lending, application 4471", expires: "2030-01-01T00:00:00.000Z" };
const HASH = "AB".repeat(32);
const bundle: ProofBundle = { v: 1, proof: { disclosure, terms, signature: ada.sign(proofStatement(disclosure, terms)) }, run: signedRun, paymentTx: HASH };

const tamperedDisclosure = JSON.parse(JSON.stringify(disclosure));
tamperedDisclosure.fields.find((f: { name: string }) => f.name === "employer.name").value = "Big Bank Plc";
const tampered = { ...bundle, proof: { ...bundle.proof, disclosure: tamperedDisclosure } };

const tx = {
  tx: { body: { memo: runMemo(run.runRoot), messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: employer.address, to_address: ada.address, amount: [{ denom: FUSD, amount: "2790500000" }] }] } },
  tx_response: { txhash: HASH, height: "10500000", timestamp: "2026-11-28T09:00:00Z", code: 0, events: [{ type: "pqc_hybrid_verify", attributes: [{ key: "address", value: employer.address }, { key: "status", value: "verified" }] }] },
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("**/lcd-testnet/**", (route) => {
  const url = route.request().url();
  const acct = /\/qorechain\/pqc\/v1\/account\/([^/?]+)/.exec(url)?.[1];
  const who = acct === employer.address ? employer : acct === ada.address ? ada : null;
  if (acct) return route.fulfill({ json: who ? { found: true, account: { public_key: b64(who.pqKey.publicKey), algorithm_id: 1, possession_proven: true } } : { found: false } });
  if (url.endsWith(`/cosmos/tx/v1beta1/txs/${HASH}`)) return route.fulfill({ json: tx });
  return route.fulfill({ status: 404, json: {} });
});

let failed = 0;
const expect = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failed++; };

await page.goto(`${BASE}/verify#${encodeProofBundle(bundle)}`);
await page.getByText("This proof checks out").waitFor({ timeout: 15000 });
const text = await page.locator("main").innerText();
expect(text.includes("Acme Logistics Ltd"), "honest proof: shows the employer the employee chose to show");
expect(text.includes("Net pay for 2026-11 was at least $2,500.00 and less than $3,000.00."), "honest proof: states the pay range in one sentence");
expect(!text.includes("Ada Obi") && !text.includes("2,790") && !text.includes("Operations Analyst"), "honest proof: name, amount and role stay hidden");
expect((await page.locator(".checks li.ok").count()) === 5, "honest proof: all five checks pass");
await page.screenshot({ path: process.env.SHOT ?? "verify-ok.png", fullPage: true });

await page.goto("about:blank"); // a hash-only change would not reload the page
await page.goto(`${BASE}/verify#${encodeProofBundle(tampered)}`);
await page.getByText("This proof does not check out").waitFor({ timeout: 15000 });
expect((await page.locator(".checks li.bad").count()) === 1, "tampered proof: refused at the fields check");
expect(!(await page.locator("main").innerText()).includes("Big Bank Plc"), "tampered proof: the forged value is never displayed");

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "verify page: all checks passed");
process.exit(failed ? 1 : 0);
