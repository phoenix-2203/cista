/**
 * Starts the Cista server. Settings come from the environment:
 *
 *   CISTA_PORT     default 8787 (listens on 127.0.0.1; Caddy serves HTTPS in front)
 *   CISTA_DB       default ./cista.db
 *   CISTA_DOMAIN   default cista.duckdns.org (must match the site's host for sign-in)
 *   CISTA_REST     default https://api-testnet.qore.host
 *   CISTA_CHAIN_ID default qorechain-diana
 *
 * No keys, mnemonics or secrets are needed: the server signs nothing.
 */
import { serve } from "@hono/node-server";
import { TESTNET } from "@phoenix-2203/cista";
import { createApp } from "./app";
import { restServerChain } from "./chain";
import { Store } from "./db";

const port = Number(process.env.CISTA_PORT ?? 8787);
const store = new Store(process.env.CISTA_DB ?? "cista.db");
const app = createApp({
  store,
  chain: restServerChain(process.env.CISTA_REST ?? TESTNET.rest),
  domain: process.env.CISTA_DOMAIN ?? "cista.duckdns.org",
  chainId: process.env.CISTA_CHAIN_ID ?? TESTNET.chainId,
});

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Cista server listening on http://127.0.0.1:${info.port}`);
});

const sweep = setInterval(() => store.sweep(), 10 * 60_000);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(sweep);
    store.close();
    process.exit(0);
  });
}
