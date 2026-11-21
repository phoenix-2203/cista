/** What the server reads from the chain. Tests pass an in-memory one. */
import { restChainReader, type ChainReader } from "@phoenix-2203/cista";

export type ServerChain = ChainReader;

export function restServerChain(rest: string): ServerChain {
  return restChainReader(rest);
}

/**
 * A read-only eth_call to one contract over JSON-RPC. Reverts come back as
 * their data (for the browser to decode); other errors as a message.
 */
export function evmCaller(rpc: string, to: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("CISTA_VERIFIER must be a 0x address");
  return async (data: string): Promise<{ result?: string; revert?: string; error?: string }> => {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data, gas: "0x1c9c380" }, "latest"] }),
    });
    if (!res.ok) throw new Error(`EVM RPC answered ${res.status}`);
    const body = (await res.json()) as { result?: string; error?: { message?: string; data?: string } };
    if (body.error) {
      return typeof body.error.data === "string" && /^0x[0-9a-fA-F]*$/.test(body.error.data)
        ? { revert: body.error.data }
        : { error: body.error.message ?? "the call failed" };
    }
    return { result: body.result };
  };
}
