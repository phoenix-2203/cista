/**
 * Reading the payment transaction of a pay run.
 *
 * Works on the JSON the chain's REST API returns for
 * `/cosmos/tx/v1beta1/txs/{hash}`. A pay run is paid either by one
 * `MsgMultiSend` or by several `MsgSend` messages in one transaction; both
 * are read as a list of transfers.
 */
import { parseRunMemo } from "./run";
import { equalBytes } from "./bytes";
import type { SignedRun } from "./sign";

export interface Transfer {
  from: string;
  to: string;
  denom: string;
  amount: bigint;
}

export interface PaymentTx {
  hash: string;
  height: number;
  time?: string;
  ok: boolean;
  memo: string;
  /** The account whose ML-DSA-87 signature the chain reported as verified, if any. */
  hybridSigner?: string;
  /** Addresses that signed (from the messages' senders). */
  senders: string[];
  transfers: Transfer[];
}

type Coin = { denom?: string; amount?: string };
type Ev = { type: string; attributes?: { key: string; value: string }[] };

const AMOUNT = /^(0|[1-9]\d*)$/;

function coins(list: unknown): { denom: string; amount: bigint }[] {
  if (!Array.isArray(list)) return [];
  return (list as Coin[]).filter((c) => typeof c?.denom === "string" && typeof c?.amount === "string" && AMOUNT.test(c.amount)).map((c) => ({ denom: c.denom!, amount: BigInt(c.amount!) }));
}

export function parsePaymentTx(body: unknown): PaymentTx {
  const b = (body ?? {}) as {
    tx?: { body?: { memo?: string; messages?: Record<string, unknown>[] } };
    tx_response?: { txhash?: string; height?: string; timestamp?: string; code?: number; events?: Ev[] };
  };
  const r = b.tx_response ?? {};
  const transfers: Transfer[] = [];
  const senders = new Set<string>();
  for (const m of b.tx?.body?.messages ?? []) {
    const type = m["@type"];
    if (type === "/cosmos.bank.v1beta1.MsgSend") {
      const from = String(m.from_address ?? "");
      senders.add(from);
      for (const c of coins(m.amount)) transfers.push({ from, to: String(m.to_address ?? ""), ...c });
    } else if (type === "/cosmos.bank.v1beta1.MsgMultiSend") {
      const inputs = Array.isArray(m.inputs) ? (m.inputs as { address?: string }[]) : [];
      // The bank module allows exactly one input; anything else is not a Cista payment.
      if (inputs.length !== 1) continue;
      const from = String(inputs[0]!.address ?? "");
      senders.add(from);
      for (const o of Array.isArray(m.outputs) ? (m.outputs as { address?: string; coins?: unknown }[]) : []) {
        for (const c of coins(o.coins)) transfers.push({ from, to: String(o.address ?? ""), ...c });
      }
    } else if (typeof type === "string") {
      senders.add("(other message)");
    }
  }
  // The ante handler emits `pqc_hybrid_verify { address, algorithm_id, status }`.
  const verified = (r.events ?? [])
    .filter((e) => e.type === "pqc_hybrid_verify")
    .map((e) => Object.fromEntries((e.attributes ?? []).map((a) => [a.key, a.value])))
    .find((a) => a.status === "verified");
  return {
    hash: (r.txhash ?? "").toUpperCase(),
    height: Number(r.height ?? 0),
    time: r.timestamp,
    ok: (r.code ?? 0) === 0,
    memo: b.tx?.body?.memo ?? "",
    hybridSigner: verified?.address,
    senders: [...senders],
    transfers,
  };
}

export interface PaymentCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Does this transaction pay the signed run? It must have succeeded, carry the
 * run root in its memo, be hybrid-signed, come only from the employer, and pay
 * out exactly the signed total in the signed denom.
 */
export function checkRunPayment(tx: PaymentTx, run: SignedRun): PaymentCheck {
  const problems: string[] = [];
  if (!tx.ok) problems.push("the payment transaction failed on chain");
  const memoRoot = parseRunMemo(tx.memo);
  const runRoot = new Uint8Array(run.runRoot.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  if (!memoRoot || !equalBytes(memoRoot, runRoot)) problems.push("the payment's memo does not carry this pay run's fingerprint");
  if (tx.hybridSigner !== run.employer) problems.push("the chain did not report a verified ML-DSA-87 signature from the employer");
  if (tx.senders.length !== 1 || tx.senders[0] !== run.employer) problems.push("the payment does not come only from the employer");
  const paid = tx.transfers.filter((t) => t.from === run.employer && t.denom === run.denom).reduce((s, t) => s + t.amount, 0n);
  if (paid !== BigInt(run.totalPayout)) problems.push(`the payment sends ${paid}${run.denom}, the signed run says ${run.totalPayout}${run.denom}`);
  if (tx.transfers.some((t) => t.denom !== run.denom)) problems.push("the payment also sends another denom");
  return { ok: problems.length === 0, problems };
}

/** Total the employer paid to one address in one denom in this transaction. */
export function paidTo(tx: PaymentTx, from: string, to: string, denom: string): bigint {
  return tx.transfers.filter((t) => t.from === from && t.to === to && t.denom === denom).reduce((s, t) => s + t.amount, 0n);
}
