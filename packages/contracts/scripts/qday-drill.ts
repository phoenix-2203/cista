/**
 * Q-Day drill: attack Cista on the live testnet as someone who has recovered
 * an account's classical secp256k1 key (what a large quantum computer could
 * derive from a public key) and nothing else.
 *
 *   pnpm --filter @cista/contracts qday:drill
 *
 * The "victim" is the throwaway account in .env.seed: the drill uses only its
 * classical private key, plus a fresh ML-DSA-87 key of the attacker's own.
 * Nothing here can move value: every attempt is meant to be refused, and the
 * one transfer tried is 0.01 test QOR to the attacker's own throwaway address.
 *
 * Writes the results to drill-results/qday-drill.md (git-ignored), for audit.md.
 */
import {
  buildPayRun,
  createDisclosure,
  encodeProofBundle,
  MEMO_PREFIX,
  proofStatement,
  restChainReader,
  signedRunStatement,
  signInStatement,
  unsignedRun,
  verifyProofBundle,
  type ProofBundle,
  type SignedRun,
} from "@phoenix-2203/cista";
import { classicalKeyFromPrivate, pqKeyFromSeed, signMessage } from "@qorechain/qoresign";
import { EthNativeSigner, deriveUnifiedAccount } from "@qorechain/sdk";
import { decodeErrorResult, getAddress, hexToBytes } from "viem";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CISTA_VERIFIER_ABI } from "../src/artifact";
import { CHAIN_ID, NATIVE_FEE, REST, rest } from "./lib/testnet";
import { createPublicClient, http } from "viem";
import { qorechainTestnet } from "@qorechain/evm";

/** Git-ignored: results land here and are committed separately, so the folder stays clean for push-commits.sh. */
const OUT = "../../drill-results";
const CISTA = process.env.CISTA_URL ?? "https://cista.duckdns.org";
const CISTA_HOST = new URL(CISTA).host;
/** A real employer and a real paid run, to impersonate (Cista's first fUSD run). */
const REAL_EMPLOYER = "qor1q3tsylvnewfylq576rm5zp08n5yfjv3xd9rf6e";
const REAL_PAYMENT = "A3978B6A03093FCBF862B3EC8538DFC4E799A7387E74F66C4140B769C6780DA5";

const mnemonic = (process.env.E2E_MNEMONIC ?? process.env.SEED_MNEMONIC)?.trim();
if (!mnemonic) throw new Error("Put the THROWAWAY testnet phrase in packages/contracts/.env.seed (copy Unyoke's).");
const victim = await deriveUnifiedAccount(mnemonic);
const bal = await rest<{ balance: { amount: string } }>(`/cosmos/bank/v1beta1/balances/${victim.cosmos}/by_denom?denom=uqor`);
if (BigInt(bal.balance?.amount ?? "0") > 50_000_000n) throw new Error("The drill account holds more than 50 QOR. Use a throwaway account.");

// What the attacker has: the victim's classical key, and an ML-DSA-87 key of their own.
const stolenClassical = classicalKeyFromPrivate(hexToBytes(victim.privateKey as `0x${string}`), "eth_secp256k1");
const attackerPq = pqKeyFromSeed(crypto.getRandomValues(new Uint8Array(32)));
const attacker = await deriveUnifiedAccount((await import("@qorechain/sdk")).generateMnemonic(256));

type Result = { n: number; target: string; attempt: string; expected: string; actual: string; blocked: boolean };
const results: Result[] = [];
async function attempt(target: string, what: string, expected: string, run: () => Promise<{ blocked: boolean; actual: string }>) {
  const n = results.length + 1;
  try {
    const r = await run();
    results.push({ n, target, attempt: what, expected, ...r });
  } catch (e) {
    results.push({ n, target, attempt: what, expected, actual: `error: ${(e as Error).message.split("\n")[0]}`, blocked: true });
  }
  const last = results.at(-1)!;
  console.log(`${String(n).padStart(2)}. ${last.blocked ? "BLOCKED" : "NOT BLOCKED"}  ${what}\n      ${last.actual}`);
}

async function broadcast(label: string, signMode: "classical" | "hybrid", account: typeof victim, messages: unknown[], memo: string) {
  const a = await rest<{ account: { account_number: string; sequence: string } }>(`/cosmos/auth/v1beta1/accounts/${account.cosmos}`);
  const signer = new EthNativeSigner(account, { signMode, rest: REST });
  const res = (await signer.signAndBroadcast(
    {
      async broadcastTx(tx: Uint8Array) {
        const r = await rest<{ tx_response: { code: number; txhash: string; raw_log: string; codespace?: string } }>("/cosmos/tx/v1beta1/txs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tx_bytes: Buffer.from(tx).toString("base64"), mode: "BROADCAST_MODE_SYNC" }),
        });
        return { code: r.tx_response.code, transactionHash: r.tx_response.txhash, rawLog: `${r.tx_response.codespace ?? ""} ${r.tx_response.raw_log}`.trim() };
      },
    },
    { chainId: CHAIN_ID, accountNumber: BigInt(a.account.account_number), sequence: BigInt(a.account.sequence), fee: NATIVE_FEE, messages: messages as never, memo },
  )) as { code: number; transactionHash: string; rawLog?: string };
  return res;
}

const send = (to: string) => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgMultiSend",
  value: { inputs: [{ address: victim.cosmos, coins: [{ denom: "uqor", amount: "10000" }] }], outputs: [{ address: to, coins: [{ denom: "uqor", amount: "10000" }] }] },
});

console.log(`Q-Day drill against ${CISTA} and qorechain-diana\n  victim (classical key stolen): ${victim.cosmos}\n  attacker's address: ${attacker.cosmos}\n`);

// ---------------------------------------------------------------- the chain
await attempt("Chain", "Pay the attacker with a Cista-style multi-send, signed with the stolen classical key only", "refused: the account has a registered PQC key", async () => {
  const r = await broadcast("classical pay run", "classical", victim, [send(attacker.cosmos)], `${MEMO_PREFIX}${"00".repeat(32)}`);
  return { blocked: r.code !== 0, actual: r.code !== 0 ? `code ${r.code}: ${r.rawLog}` : `ACCEPTED ${r.transactionHash}` };
});

await attempt("Chain", "Same payment, hybrid-signed with the attacker's own ML-DSA-87 key", "refused: the ML-DSA-87 layer doesn't match the registered key", async () => {
  const forged = { ...victim, pqc: attackerPq } as typeof victim;
  const r = await broadcast("forged hybrid", "hybrid", forged, [send(attacker.cosmos)], "cista drill");
  return { blocked: r.code !== 0, actual: r.code !== 0 ? `code ${r.code}: ${r.rawLog}` : `ACCEPTED ${r.transactionHash}` };
});

// ------------------------------------------------------------ the Cista server
async function signInWith(signature: unknown) {
  const n = (await (await fetch(`${CISTA}/api/auth/nonce`, { method: "POST" })).json()) as { nonce: string; issuedAt: string; domain: string };
  const statement = signInStatement({ domain: n.domain, address: victim.cosmos, chainId: CHAIN_ID, nonce: n.nonce, issuedAt: n.issuedAt });
  const sig = typeof signature === "function" ? (signature as (s: string) => unknown)(statement) : signature;
  const r = await fetch(`${CISTA}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: victim.cosmos, nonce: n.nonce, issuedAt: n.issuedAt, signature: sig }) });
  return { status: r.status, body: (await r.json()) as { error?: string } };
}

await attempt("Cista server", "Sign in as the victim with the stolen classical key only", "401", async () => {
  const r = await signInWith((s: string) => signMessage({ chainId: CHAIN_ID, signer: victim.cosmos, data: s, classicalKey: stolenClassical }));
  return { blocked: r.status === 401, actual: `HTTP ${r.status}: ${r.body.error}` };
});

await attempt("Cista server", "Sign in as the victim, hybrid-signed with the attacker's own ML-DSA-87 key", "401", async () => {
  const r = await signInWith((s: string) => signMessage({ chainId: CHAIN_ID, signer: victim.cosmos, data: s, classicalKey: stolenClassical, pqKey: attackerPq }));
  return { blocked: r.status === 401, actual: `HTTP ${r.status}: ${r.body.error}` };
});

await attempt("Cista server", "Publish a key card for the victim (to have payslips sealed to the attacker), without a session", "401", async () => {
  const r = await fetch(`${CISTA}/api/cards`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ card: { address: victim.cosmos }, mlkemPublicKey: "00" }) });
  return { blocked: r.status === 401, actual: `HTTP ${r.status}: ${((await r.json()) as { error?: string }).error}` };
});

await attempt("Cista server", "Read the victim's sealed payslips without a session", "401", async () => {
  const r = await fetch(`${CISTA}/api/me/payslips`);
  return { blocked: r.status === 401, actual: `HTTP ${r.status}: ${((await r.json()) as { error?: string }).error}` };
});

// ------------------------------------------------------- forged proof of pay
const forgedRun = (() => {
  const slip = {
    version: 1 as const,
    employer: { address: REAL_EMPLOYER, name: "myPh0enix" },
    employee: { address: attacker.cosmos, name: "Attacker", staffId: "X", role: "CEO", employedSince: "2020-01-01" },
    period: "2026-11",
    payDate: "2026-11-21",
    currency: "USD",
    earnings: [{ code: "basic", label: "Basic salary", amount: 5_000_000n }],
    deductions: [],
    employerContributions: [],
    payout: { address: attacker.cosmos, denom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", amount: 50_000_000_000n },
    thresholds: [2_500_000n],
  };
  const run = buildPayRun(CHAIN_ID, [{ slip, seed: crypto.getRandomValues(new Uint8Array(32)) }]);
  const body = unsignedRun(run);
  // The attacker can't produce the real employer's ML-DSA-87 signature, so signs with their own key.
  const signed: SignedRun = { ...body, signature: signMessage({ chainId: CHAIN_ID, signer: REAL_EMPLOYER, data: signedRunStatement(body), classicalKey: stolenClassical, pqKey: attackerPq }) };
  return { run, signed };
})();

await attempt("Proof of pay", `A forged proof: "earns at least $25,000 a month at ${REAL_EMPLOYER.slice(0, 12)}…", pointing at a real Cista payment`, "refused: neither the employer's nor a registered employee's ML-DSA-87 signature", async () => {
  const { run, signed } = forgedRun;
  const disclosure = createDisclosure(run, run.slips[0]!, ["employer.name", "net.atLeast.2500000"]);
  const terms = { audience: "Any Bank", expires: "2030-01-01T00:00:00Z" };
  const bundle: ProofBundle = {
    v: 1,
    proof: { disclosure, terms, signature: signMessage({ chainId: CHAIN_ID, signer: attacker.cosmos, data: proofStatement(disclosure, terms), classicalKey: classicalKeyFromPrivate(hexToBytes(attacker.privateKey as `0x${string}`), "eth_secp256k1"), pqKey: attacker.pqc }) },
    run: signed,
    paymentTx: REAL_PAYMENT,
  };
  const v = await verifyProofBundle(bundle, restChainReader(REST));
  const bad = v.checks.find((c) => !c.ok);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/forged-proof.txt`, `${CISTA}/verify#${encodeProofBundle(bundle)}\n`);
  return { blocked: !v.ok, actual: bad ? `refused at "${bad.id}": ${bad.text}` : "ACCEPTED" };
});

// ------------------------------------------------------- on-chain verifier
const deployment = existsSync(OUT + "/deployment-testnet.json") ? (JSON.parse(readFileSync(OUT + "/deployment-testnet.json", "utf8")) as { CistaVerifier: string }) : null;
if (deployment) {
  const pub = createPublicClient({ chain: qorechainTestnet, transport: http() });
  await attempt("CistaVerifier", "The same forged run submitted to the on-chain verifier", "revert BadSignature", async () => {
    const s = forgedRun.signed;
    try {
      await pub.readContract({
        address: getAddress(deployment.CistaVerifier),
        abi: CISTA_VERIFIER_ABI,
        functionName: "verifyRun",
        args: [{ chainId: s.chainId, employer: s.employer, period: s.period, count: BigInt(s.count), totalPayout: BigInt(s.totalPayout), denom: s.denom, runRoot: `0x${s.runRoot}` }, `0x${Buffer.from(s.signature.pq!.signature, "base64").toString("hex")}`],
      });
      return { blocked: false, actual: "ACCEPTED" };
    } catch (e) {
      const data = (e as { cause?: { data?: `0x${string}` } }).cause?.data;
      return { blocked: true, actual: data ? `revert ${decodeErrorResult({ abi: CISTA_VERIFIER_ABI, data }).errorName}` : (e as Error).message.split("\n")[0]! };
    }
  });
} else {
  console.log("(skipped the on-chain verifier: run deploy:testnet first)");
}

// ---------------------------------------------------------------- report
const blocked = results.filter((r) => r.blocked).length;
const md = [
  "# Q-Day drill: live results",
  "",
  `Run ${new Date().toISOString()} against ${CISTA_HOST} and qorechain-diana by \`pnpm --filter @cista/contracts qday:drill\`.`,
  "",
  `Victim (classical key stolen): \`${victim.cosmos}\`. Attacker: \`${attacker.cosmos}\` with a fresh ML-DSA-87 key.`,
  "",
  "| # | Target | Attempt | Expected | Actual | Result |",
  "| --- | --- | --- | --- | --- | --- |",
  ...results.map((r) => `| ${r.n} | ${r.target} | ${r.attempt} | ${r.expected} | ${r.actual.replace(/\|/g, "\\|")} | ${r.blocked ? "Blocked" : "**NOT BLOCKED**"} |`),
  "",
  `**${blocked} of ${results.length} attacks blocked.**`,
  "",
].join("\n");
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/qday-drill.md`, md);
console.log(`\n${blocked} of ${results.length} blocked. Wrote drill-results/qday-drill.md (Claude reads it from there).`);
