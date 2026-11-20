/** What the server reads from the chain. Tests pass an in-memory one. */
import { restChainReader, type ChainReader } from "@phoenix-2203/cista";
import { fetchKemKey } from "@qorechain/qoreseal/network";

export interface ServerChain extends ChainReader {
  /** The account's registered ML-KEM-1024 key, or null. */
  kemKey(address: string): Promise<Uint8Array | null>;
}

export function restServerChain(rest: string): ServerChain {
  const reader = restChainReader(rest);
  return {
    ...reader,
    async kemKey(address) {
      const k = await fetchKemKey({ rest, address });
      return k.registered && k.publicKey ? k.publicKey : null;
    },
  };
}
