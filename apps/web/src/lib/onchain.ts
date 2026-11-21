/**
 * "Check on chain": ask the CistaVerifier contract to check a proof of pay.
 *
 * The contract reads the employer's ML-DSA-87 key from QoreChain's PQC Key
 * Status precompile, verifies the employer's signature over the pay run with
 * the PQC Verify precompile, and checks every shown field up to the signed run
 * root. The browser builds the call and decodes the answer itself; the Cista
 * server only forwards the read-only eth_call (this page's strict CSP keeps it
 * from talking to other hosts).
 */
import { CISTA_VERIFIER_ABI } from "@cista/contracts/artifact";
import deployment from "@cista/contracts/deployments/testnet.json";
import type { ProofBundle } from "@phoenix-2203/cista";
import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, getAddress, type Hex } from "viem";

export const VERIFIER = getAddress(deployment.CistaVerifier);
export const EXPLORER_ADDRESS = "https://explore.qore.network/address/";

const REASONS: Record<string, string> = {
  BadSignature: "the pay run's signature does not verify against the employer's registered ML-DSA-87 key",
  NoRegisteredKey: "the employer has no ML-DSA-87 key registered on chain",
  BadProof: "the shown fields don't lead to the signed pay run",
  NoEmployeeField: "the proof doesn't say whose payslip it is",
  BadAddress: "an address in the proof is not a valid qor1 address",
  PrecompileInactive: "the chain's post-quantum precompiles didn't answer",
};

export type OnChainResult = { ok: true; employer: string; employee: string } | { ok: false; reason: string };

const b64ToHex = (b64: string): Hex => `0x${Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}`;

export function verifyFieldsCall(bundle: ProofBundle): Hex {
  const { run, proof } = bundle;
  const d = proof.disclosure;
  if (!run.signature.pq) throw new Error("the pay run has no ML-DSA-87 signature");
  return encodeFunctionData({
    abi: CISTA_VERIFIER_ABI,
    functionName: "verifyFields",
    args: [
      {
        chainId: run.chainId,
        employer: run.employer,
        period: run.period,
        count: BigInt(run.count),
        totalPayout: BigInt(run.totalPayout),
        denom: run.denom,
        runRoot: `0x${run.runRoot}`,
      },
      b64ToHex(run.signature.pq.signature),
      BigInt(d.slipIndex),
      d.slipSiblings.map((s) => `0x${s}` as Hex),
      d.fields.map((f) => ({ name: f.name, value: f.value, salt: `0x${f.salt}` as Hex, index: BigInt(f.index), siblings: f.siblings.map((s) => `0x${s}` as Hex) })),
    ],
  });
}

export async function checkOnChain(bundle: ProofBundle): Promise<OnChainResult> {
  const res = await fetch("/api/verifier/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: verifyFieldsCall(bundle) }),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: Hex; revert?: Hex; error?: string };
  if (!res.ok) throw new Error(body.error ?? `the server answered ${res.status}`);
  if (body.revert) {
    try {
      const name = decodeErrorResult({ abi: CISTA_VERIFIER_ABI, data: body.revert }).errorName;
      return { ok: false, reason: REASONS[name] ?? name };
    } catch {
      return { ok: false, reason: "the contract refused the proof" };
    }
  }
  if (!body.result) return { ok: false, reason: body.error ?? "no answer from the contract" };
  const [employer, employee] = decodeFunctionResult({ abi: CISTA_VERIFIER_ABI, functionName: "verifyFields", data: body.result }) as readonly [string, string];
  return { ok: true, employer, employee };
}
