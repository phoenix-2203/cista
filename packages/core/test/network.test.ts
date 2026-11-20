import { describe, expect, it } from "vitest";
import { restChainReader } from "../src/network";

type Reply = { status: number; body: unknown };

function fakeFetch(routes: Record<string, Reply>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(routes).find(([path]) => url.endsWith(path));
    const r = hit?.[1] ?? { status: 404, body: { message: "not found" } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

const HASH = "AB".repeat(32);

describe("restChainReader", () => {
  it("reads a payment transaction by hash", async () => {
    const { f, calls } = fakeFetch({
      [`/cosmos/tx/v1beta1/txs/${HASH}`]: { status: 200, body: { tx: { body: { memo: "m", messages: [] } }, tx_response: { txhash: HASH, height: "5", code: 0, events: [] } } },
    });
    const tx = await restChainReader("https://rest.test", f).paymentTx(HASH.toLowerCase());
    expect(tx?.height).toBe(5);
    expect(calls).toEqual([`https://rest.test/cosmos/tx/v1beta1/txs/${HASH}`]);
  });

  it("answers null for an unknown transaction and refuses junk hashes without asking", async () => {
    const { f, calls } = fakeFetch({});
    const reader = restChainReader("https://rest.test", f);
    expect(await reader.paymentTx(HASH)).toBeNull();
    expect(await reader.paymentTx("../../bank/v1beta1/balances")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("raises on a server error instead of calling the proof false", async () => {
    const { f } = fakeFetch({ [`/txs/${HASH}`]: { status: 503, body: {} } });
    await expect(restChainReader("https://rest.test", f).paymentTx(HASH)).rejects.toThrow(/503/);
  });
});
