/**
 * The chain reader over QoreChain's public REST API. Used by the verify page
 * and the server; tests use an in-memory reader instead.
 */
import { fetchPqKeyStatus } from "@qorechain/qoresign/network";
import { parsePaymentTx } from "./payment";
import type { ChainReader } from "./verify";

export const TESTNET = {
  chainId: "qorechain-diana",
  rest: "https://api-testnet.qore.host",
  denom: "uqor",
} as const;

export function restChainReader(rest: string = TESTNET.rest, fetchImpl: typeof fetch = fetch): ChainReader {
  return {
    async pqKey(address) {
      const status = await fetchPqKeyStatus({ rest, address, fetch: fetchImpl });
      if (!status.registered || !status.publicKey) return null;
      return { publicKey: status.publicKey, possessionProven: status.possessionProven === true };
    },
    async paymentTx(hash) {
      if (!/^[0-9A-Fa-f]{64}$/.test(hash)) return null;
      const res = await fetchImpl(`${rest}/cosmos/tx/v1beta1/txs/${hash.toUpperCase()}`);
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`the chain's REST API answered ${res.status}`);
      return parsePaymentTx(await res.json());
    },
  };
}
