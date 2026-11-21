/**
 * Deploy CistaVerifier to the QoreChain TESTNET from the throwaway account in
 * packages/contracts/.env.seed, then check it against a REAL pay run:
 *
 *   pnpm --filter @cista/contracts deploy:testnet [runRoot]
 *
 * 1. Opens a 1-transaction EVM window (unscoped: a scoped window refuses
 *    contract creation), hybrid-signed, and deploys.
 * 2. Reads a signed pay run from cista.duckdns.org (by default the first run
 *    paid in fUSD) and calls verifyRun: the employer's ML-DSA-87 signature,
 *    made in QoreX, is checked by the chain's PQC precompiles.
 * 3. Calls it again with the total raised by one unit, which must be refused.
 *
 * Writes the address to drill-results/deployment-testnet.json (git-ignored;
 * Claude commits it into packages/contracts/deployments/).
 */
import { decodeErrorResult, getAddress } from "viem";
import { mkdirSync, writeFileSync } from "node:fs";
import { CISTA_VERIFIER_ABI, CISTA_VERIFIER_BYTECODE } from "../src/artifact";
import { MAX_FEE_PER_GAS, loadTestAccount } from "./lib/testnet";

const CISTA = "https://cista.duckdns.org";
const RUN = process.argv[2] ?? "47f10efc4f5681edd55c8ff478490dacee73dbf3d16e57b218d635188f4d649f";
const GAS = 2_500_000n;

const t = await loadTestAccount();
console.log(`Deploying CistaVerifier from ${t.qor} (${t.evm})`);
const win = await t.openWindow([], 1, GAS);
console.log(`  window (1 tx): ${win}`);
await new Promise((r) => setTimeout(r, 6000)); // let the window's block land first

const hash = await t.wallet.deployContract({
  account: t.wallet.account!,
  chain: t.wallet.chain,
  abi: CISTA_VERIFIER_ABI,
  bytecode: CISTA_VERIFIER_BYTECODE,
  gas: GAS,
  maxFeePerGas: MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: 1_000_000_000n,
});
const rcpt = await t.pub.waitForTransactionReceipt({ hash });
if (rcpt.status !== "success" || !rcpt.contractAddress) throw new Error(`Deployment failed: ${hash}`);
const address = getAddress(rcpt.contractAddress);
console.log(`  deployed: ${address} (tx ${hash}, block ${rcpt.blockNumber})`);

// --- Check it against a real pay run signed in QoreX ------------------------
const res = await fetch(`${CISTA}/api/runs/${RUN}`);
if (!res.ok) throw new Error(`could not read pay run ${RUN} from ${CISTA}: ${res.status}`);
const { run } = (await res.json()) as {
  run: { chainId: string; employer: string; period: string; count: number; totalPayout: string; denom: string; runRoot: string; signature: { pq: { signature: string } } };
};
const header = {
  chainId: run.chainId,
  employer: run.employer,
  period: run.period,
  count: BigInt(run.count),
  totalPayout: BigInt(run.totalPayout),
  denom: run.denom,
  runRoot: `0x${run.runRoot}` as `0x${string}`,
};
const pqSig = `0x${Buffer.from(run.signature.pq.signature, "base64").toString("hex")}` as `0x${string}`;

const employer = await t.pub.readContract({ address, abi: CISTA_VERIFIER_ABI, functionName: "verifyRun", args: [header, pqSig] });
const gas = await t.pub.estimateContractGas({ address, abi: CISTA_VERIFIER_ABI, functionName: "verifyRun", args: [header, pqSig], account: t.evm });
console.log(`  real run ${RUN.slice(0, 8)}…: employer ${run.employer} signature verified on chain -> ${employer} (${gas} gas)`);

let refused = "";
try {
  await t.pub.readContract({ address, abi: CISTA_VERIFIER_ABI, functionName: "verifyRun", args: [{ ...header, totalPayout: header.totalPayout + 1n }, pqSig] });
} catch (e) {
  const data = (e as { cause?: { data?: `0x${string}` }; data?: `0x${string}` }).cause?.data ?? (e as { data?: `0x${string}` }).data;
  refused = data ? decodeErrorResult({ abi: CISTA_VERIFIER_ABI, data }).errorName : (e as Error).message.split("\n")[0]!;
}
if (!refused) throw new Error("a run with a raised total was accepted: do not use this deployment");
console.log(`  same run with the total raised by 1: refused (${refused})`);

mkdirSync("../../drill-results", { recursive: true });
writeFileSync(
  "../../drill-results/deployment-testnet.json",
  JSON.stringify({ chainId: "qorechain-diana", evmChainId: 9800, CistaVerifier: address, deployTx: hash, block: Number(rcpt.blockNumber), checkedAgainstRun: RUN, verifyRunGas: Number(gas) }, null, 2) + "\n",
);
console.log(`\nWrote drill-results/deployment-testnet.json. Claude reads it from there.`);
