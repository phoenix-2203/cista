# Cista

[![Built on QoreChain](https://build.qorechain.io/badge/cista.svg)](https://build.qorechain.io/p/cista)

Sealed payroll on QoreChain: everyone gets paid, only you see your payslip.

Cista runs payroll on the QoreChain testnet (`qorechain-diana`):

- **Sealed payslips.** Each payslip is sealed in the browser with ML-KEM-1024 (QoreSeal) to the employee's key in QoreChain's PQC registry. The server stores ciphertext only.
- **One payment, one fingerprint.** A single hybrid-signed (secp256k1 + ML-DSA-87) transaction pays the whole team and carries the pay run's fingerprint in its memo.
- **Proof of pay, without the payslip.** An employee can show a lender one fact (net pay, employer, "salary above ₦X") and keep the rest sealed. The lender checks it without a wallet.

Work in progress for QoreChain's [Build Before Q-Day](https://build.qorechain.io) fest, **Encrypted Apps** track. Testnet only.

## Status

| Part | State |
| --- | --- |
| Core library (`packages/core`) | Built: payslip model, field commitments, pay-run fingerprint, sealing, signatures, bank messages, key vault, payment check, proof of pay. 147 tests |
| Server (`apps/server`) | Built: sign-in, recipient cards, pay runs, payments, employee inbox. 24 tests |
| Web app (`apps/web`) | Built: key setup, employer pay run, employee payslips and proofs, lender check page. 8 tests, plus a browser check of the verify page |
| Live on testnet | Next: deploy to cista.duckdns.org and run the first real pay run |
| `CistaRegistry` contract | Planned: checks the employer's ML-DSA-87 signature on chain |
| Q-Day attack drill (`audit.md`) | Planned |

## How it works

```
payslip fields ──salted SHA-256──▶ field commitments ──Merkle──▶ slip root   (one per payslip)
slip roots     ──────────────────────────────────────Merkle──▶ run root    (one per pay run)
```

1. **The employer builds the pay run** in the browser. Every payslip field (net pay, PAYE, pension, payout address, "net pay is at least ₦250,000"…) is committed on its own with a 32-byte salt, so each field can later be shown alone. Amounts are kept in kobo as integers.
2. **The employer signs the run root in QoreX** (`signArbitrary`, hybrid secp256k1 + ML-DSA-87). The statement is readable text: chain, employer, period, number of payslips, total payout, run root.
3. **Each payslip is sealed** with QoreSeal (ML-KEM-1024 + X25519) to the employee and the employer, so the employer can re-seal it if the employee loses their key. The envelope is bound to its chain, employer, period, employee and run root, padded to a fixed size, and does not say who it is for.
4. **One transaction pays the team**, hybrid-signed, with `cista:v1:<run root>` in its memo. The server only records it once the chain shows it pays exactly the signed total, from the employer, with the employer's ML-DSA-87 signature verified.
5. **The employee opens their payslip** and checks it against the signed run root.
6. **Proof of pay.** The employee picks fields to show and signs a short statement naming who the proof is for and when it expires. A lender checks, with no wallet: the fields come from the payslip unchanged, the employee and the employer signed with their registered ML-DSA-87 keys, the run was paid on chain, and (if shown) the payout reached the employee.

Every signature is checked against the key registered on chain, never a key the signature brings along. A signature with only the classical (secp256k1) part is refused: that is the part a quantum computer could forge.

**What stays public:** payment amounts and addresses, like every transfer on chain, and the fact that an address received a payslip. What stays sealed: who the person is, their gross pay, tax, deductions, role and personal details.

## Run it

Node 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm test                       # core library and server tests
pnpm --filter @cista/server start   # server on http://127.0.0.1:8787
```

For the web app in development, run the server with `CISTA_DOMAIN=localhost:5173`, then `pnpm --filter @cista/web dev`. The browser check of the verify page needs Playwright: `pnpm --filter @cista/web build && pnpm --filter @cista/web preview`, then `pnpm --filter @cista/web e2e:verify`.

The server takes `CISTA_PORT`, `CISTA_DB`, `CISTA_DOMAIN`, `CISTA_REST` and `CISTA_CHAIN_ID` from the environment. It needs no keys or secrets: it signs nothing.

## Deploy

On a VPS that already runs Caddy, with Node.js 22.13 or newer and a DuckDNS name pointing at it, run as root:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phoenix-2203/cista/main/deploy/setup.sh)
```

It builds the web app, runs the server as a hardened systemd service under its own user (on the first free port from 8787, or `CISTA_PORT`), and adds a Caddy site with a strict Content-Security-Policy. Other sites on the server are left alone. Run it again to update.

## Credits

Open source libraries and QoreChain kits Cista uses:

| Library | Licence | Used for |
| --- | --- | --- |
| [@qorechain/qoreseal](https://github.com/qorechain/qoreseal) | Apache-2.0 | ML-KEM-1024 + X25519 sealing, recipient cards, the KEM key registry |
| [@qorechain/qoresign](https://github.com/qorechain/qoresign) | Apache-2.0 | Checking hybrid secp256k1 + ML-DSA-87 signatures; reading registered keys |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) | MIT | SHA-256 and HMAC for field commitments and the Merkle tree |
| [Hono](https://github.com/honojs/hono) and [@hono/node-server](https://github.com/honojs/node-server) | MIT | The server's HTTP API |
| [tsx](https://github.com/privatenumber/tsx) | MIT | Running the TypeScript server |
| [React](https://github.com/facebook/react) and [Vite](https://github.com/vitejs/vite) | MIT | The web app |
| [Vitest](https://github.com/vitest-dev/vitest) and [TypeScript](https://github.com/microsoft/TypeScript) | MIT, Apache-2.0 | Tests and type checking |

The server's store uses `node:sqlite`, built into Node.js.

## Licence

MIT
