/** What the server reads from the chain. Tests pass an in-memory one. */
import { restChainReader, type ChainReader } from "@phoenix-2203/cista";

export type ServerChain = ChainReader;

export function restServerChain(rest: string): ServerChain {
  return restChainReader(rest);
}
