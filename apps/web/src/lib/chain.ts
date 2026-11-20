/**
 * Reading the chain from the browser, through the site's read-only
 * /lcd-testnet relay (the chain's REST API sends no CORS headers).
 */
import { restChainReader, type ChainReader } from "@phoenix-2203/cista";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import { fetchPqKeyStatus } from "@qorechain/qoresign/network";

export const REST = "/lcd-testnet";
export const EXPLORER_TX = "https://explore.qore.network/tx/";

const rest = () => new URL(REST, location.origin).toString().replace(/\/$/, "");

export const chain: ChainReader = restChainReader(rest());

export async function kemKeyOf(address: string): Promise<Uint8Array | null> {
  const k = await fetchKemKey({ rest: rest(), address });
  return k.registered && k.publicKey ? k.publicKey : null;
}

export async function pqKeyOf(address: string): Promise<{ publicKey: Uint8Array; possessionProven: boolean } | null> {
  const k = await fetchPqKeyStatus({ rest: rest(), address });
  return k.registered && k.publicKey ? { publicKey: k.publicKey, possessionProven: k.possessionProven === true } : null;
}

export async function balanceOf(address: string, denom = "uqor"): Promise<bigint> {
  const res = await fetch(`${rest()}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(denom)}`);
  if (!res.ok) throw new Error(`could not read the balance (${res.status})`);
  const body = (await res.json()) as { balance?: { amount?: string } };
  return BigInt(body.balance?.amount ?? "0");
}

/** Waits until the chain's REST API knows a transaction (it can lag the wallet by a block or two). */
export async function waitForTx(hash: string, tries = 15): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await chain.paymentTx(hash).catch(() => null)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("the chain hasn't shown this transaction yet; try again in a moment");
}
