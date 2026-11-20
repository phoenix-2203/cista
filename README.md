# Cista

[![Built on QoreChain](https://build.qorechain.io/badge/cista.svg)](https://build.qorechain.io/p/cista)

Sealed payroll on QoreChain: everyone gets paid, only you see your payslip.

Cista runs payroll on the QoreChain testnet (`qorechain-diana`):

- **Sealed payslips.** Each payslip is sealed in the browser with ML-KEM-1024 (QoreSeal) to the employee's key, which the employee vouched for with a key card signed by their ML-DSA-87 key registered on chain. The server stores ciphertext only.
- **One payment, one fingerprint.** A single hybrid-signed (secp256k1 + ML-DSA-87) transaction pays the whole team in fUSD and carries the pay run's fingerprint in its memo.
- **Proof of pay, without the payslip.** An employee can show a lender one fact (net pay, employer, "salary above ₦X") and keep the rest sealed. The lender checks it without a wallet.

Work in progress for QoreChain's [Build Before Q-Day](https://build.qorechain.io) fest, **Encrypted Apps** track. Testnet only.

## Status

| Part | State |
| --- | --- |
| Core library (`packages/core`) | Built: payslip model, field commitments, pay-run fingerprint, sealing, signatures, bank messages, key vault, payment check, proof of pay. 147 tests |
| Server (`apps/server`) | Built: sign-in, recipient cards, pay runs, payments, employee inbox. 24 tests |
| Web app (`apps/web`) | Built: key setup, employer pay run, employee payslips and proofs, lender check page. 8 tests, plus a browser check of the verify page |
| Live on testnet | Live at https://cista.duckdns.org; first real pay run and proof of pay done (see below) |
| `CistaRegistry` contract | Planned: checks the employer's ML-DSA-87 signature on chain |
| Q-Day attack drill (`audit.md`) | Planned |

## Proven on testnet

| What | Where |
| --- | --- |
| A real pay run paid by QoreX with one `MsgMultiSend`, hybrid-signed (the chain reports `pqc_hybrid_verify … status=verified` for the employer), carrying the run root `aa1868d9…4ce1` in its memo | [`F205402C…7A6FDF`](https://explore.qore.network/tx/F205402C3F9EABF2E393F5D83B71EE1E016791516F3F3B8356D7E15E787A6FDF), block 10,442,970, 20 Nov 2026 |
| The employee opened the sealed payslip in the browser, made a proof of pay (employer, period, net pay) for "Test Bank", and the check page passed all five checks with no wallet | https://cista.duckdns.org/verify |

That first run paid in QOR. Pay runs now pay in fUSD (see "Money" below).

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

**Money.** Payslips are in US dollars and paid in fUSD, the fest's dollar stablecoin, one to one, as stablecoin payrolls do (Bron's confidential payroll on Ethereum paid in USDT). fUSD is an ERC-20 token that also exists on QoreChain's native lane as the bank denom `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA` (6 decimals), so one hybrid-signed `MsgMultiSend` from QoreX still pays the whole team. Transaction fees are paid in QOR.

**Proof types.** The employee picks one of the standard verification types lenders and landlords ask for, or a custom set of lines: employment (employer, role, start date), income above an amount, income in a range, or exact pay with the on-chain payment. Every payslip answers "is net pay at least $X?" for a ladder of 23 bands from $250 to $50,000 a month, so "income above" is one band and "income in a range" is a band answered yes plus the next one answered no: the amount itself is never shown. Zama's own developer forum notes that FHE payrolls keep salaries confidential but leave them unverifiable to banks and landlords; its planned fix is time-limited decryption for another wallet. Cista's proofs need no wallet on the lender's side, reveal a band rather than the amount, are tied to the actual payment, name who they are for, and expire.

**Keys.** Each person makes their sealing keys in the browser from a 24-word recovery phrase, shown once (QoreSeal's standard derivation from a BIP-39 phrase; it is not the wallet's seed phrase and holds no funds). A password locks a copy in the browser, and the key stays unlocked in that tab for up to 30 minutes of inactivity, wrapped by a non-extractable WebCrypto key. A forgotten password is recovered with the phrase, the way Proton handles data recovery; if both are lost, the employee makes a new key and the employer re-seals past payslips to it, since every payslip is also sealed to the employer.

**Key cards.** Each person also publishes a key card: their ML-KEM-1024 key's SHA3-256 and their X25519 key, signed in QoreX. An employer only seals to keys whose card verifies against the employee's ML-DSA-87 key registered on chain, so a server that swaps in its own key is caught. We meant to register the ML-KEM key in the chain's KEM registry too, but QoreX refuses `MsgRegisterKEMKey` from websites ("managed by the wallet itself"), so the signed card carries it instead; Cista still falls back to a registry key when an account has one and no card.

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
| [@qorechain/qoreseal](https://github.com/qorechain/qoreseal) | Apache-2.0 | ML-KEM-1024 + X25519 sealing and signed recipient (key) cards |
| [@qorechain/qoresign](https://github.com/qorechain/qoresign) | Apache-2.0 | Checking hybrid secp256k1 + ML-DSA-87 signatures; reading registered keys |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) | MIT | SHA-256 and HMAC for field commitments and the Merkle tree |
| [Hono](https://github.com/honojs/hono) and [@hono/node-server](https://github.com/honojs/node-server) | MIT | The server's HTTP API |
| [tsx](https://github.com/privatenumber/tsx) | MIT | Running the TypeScript server |
| [React](https://github.com/facebook/react) and [Vite](https://github.com/vitejs/vite) | MIT | The web app |
| [Vitest](https://github.com/vitest-dev/vitest) and [TypeScript](https://github.com/microsoft/TypeScript) | MIT, Apache-2.0 | Tests and type checking |

The server's store uses `node:sqlite`, built into Node.js.

## Licence

MIT
