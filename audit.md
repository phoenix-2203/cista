# Cista security audit

This is an internal audit: we tried to break Cista and wrote down what happened. Every result below was run against the code in this repository and, where noted, against the live QoreChain testnet (`qorechain-diana`) and the live site, https://cista.duckdns.org. Findings that came up while building are kept in the **Findings** section with how each was fixed.

It is not a third-party audit. What Cista does not protect is listed under **Limitations**.

| | |
| --- | --- |
| Date | 21 November 2026 |
| Commit audited | the commit that adds this file |
| Contract | `CistaVerifier` at [`0xF26924d19029d1F1A253a3e079b16fD68B8519d8`](https://explore.qore.network/address/0xF26924d19029d1F1A253a3e079b16fD68B8519d8) (testnet, block 10,503,663) |
| Wallet | QoreX browser extension, testnet, capabilities `signArbitrary` and `signAndBroadcast` |
| Automated tests | 239, all passing: 160 core library, 30 server, 32 web app, 17 contract (local EVM), plus a browser check of the proof page and of passkey unlock |

## Summary

| Area | Attempts | Blocked / passed | Where |
| --- | --- | --- | --- |
| Stolen classical key, live (Q-Day drill) | 8 | 8 blocked | [docs/qday-drill.md](docs/qday-drill.md) |
| On-chain verifier, live | 2 | 2 passed | a real QoreX-signed run verified; the same run with the total raised by 1 refused |
| On-chain verifier, local EVM | 17 tests | 17 | `packages/contracts/test` |
| Sealing, commitments, signatures, proofs, the key vault | 160 tests | 160 | `packages/core/test` |
| Server API (sign-in, key cards, runs, re-seal, payments, eth_call relay) | 30 tests | 30 | `apps/server/test` |
| Proof page in a real browser | 6 checks | 6 | `apps/web/e2e/verify-page.ts` |
| Real pay runs on testnet | 2 | 2 | multi-send in QOR, then in fUSD; payslips opened; proofs checked |
| Live team pay run (3 people, one transaction) | 16 checks | 16 | [docs/team-run.md](docs/team-run.md) |

No attack let anyone read a payslip, move money, sign in as someone else, or pass a false proof of pay.

## Threat model

Cista makes four promises, and the audit tests exactly those:

1. **Only the employee and the employer can read a payslip.** It is sealed in the employer's browser with QoreSeal (ML-KEM-1024 + X25519) to both of them. The server stores ciphertext only.
2. **Only you can pay, sign in, or sign a pay run as you.** Every one of these needs your ML-DSA-87 key, which never leaves QoreX: native transactions are hybrid-signed, and every text signature is checked against the key registered on chain, never against a key the signature brings along.
3. **A proof of pay can't be forged or altered.** Each payslip field is a salted SHA-256 commitment in a Merkle tree under a run root the employer signed with ML-DSA-87; the employee signs each proof for a named recipient and an expiry; the run must be paid on chain by the employer, hybrid-signed.
4. **The server can't swap keys, envelopes or payslips without being caught.** Employers only seal to key cards that verify against the employee's registered ML-DSA-87 key; employees check every payslip against the signed run root.

The attackers considered:

| | Attacker | Has |
| --- | --- | --- |
| A1 | **Q-Day thief** (the headline attacker) | an account's classical secp256k1 key, which a large quantum computer could derive from a public key, and nothing else |
| A2 | **Harvest now, decrypt later** | a full copy of Cista's database and network traffic, kept until quantum computers can break today's encryption |
| A3 | **Malicious or hacked Cista server** | full control of the server and its database |
| A4 | **Dishonest employee** | their own payslip and keys, wanting a better proof than the truth |
| A5 | **Dishonest verifier** | a proof of pay sent to them, wanting to reuse it |
| A6 | **Curious colleague** | their own account and payslip in the same run |

## 1. Stolen classical key, live (A1)

Script: [`packages/contracts/scripts/qday-drill.ts`](packages/contracts/scripts/qday-drill.ts), run on 21 November 2026. The victim is a throwaway testnet account with a registered ML-DSA-87 key, playing an employer; the drill uses only its classical private key. The attacker has a fresh ML-DSA-87 key and, for attack 7, an account of its own set up honestly (funded with 0.2 test QOR, key registered: `E7F9DC9D…F068D`, `9D4F698C…4291D`).

| # | Attempt | Result |
| --- | --- | --- |
| 1 | Pay the attacker with a Cista-style multi-send, classical signature only | Refused by the chain: "has a registered PQC key and must include the hybrid signature extension" |
| 2 | The same payment, hybrid-signed with the attacker's own ML-DSA-87 key | Refused by the chain: "hybrid PQC signature verification failed" |
| 3 | Sign in to Cista as the victim, classical signature only | HTTP 401 |
| 4 | Sign in as the victim with the attacker's own ML-DSA-87 key | HTTP 401: does not verify against the registered key |
| 5 | Publish a key card for the victim, so payslips would be sealed to the attacker | HTTP 401 |
| 6 | Read the victim's sealed payslips | HTTP 401 |
| 7 | A forged "at least $25,000 a month" proof from the victim employer, signed by the attacker's own registered account, pointing at a real Cista payment | Refused at the employer's signature |
| 8 | The same forged run submitted to `CistaVerifier` on chain | `revert BadSignature` |

**8 of 8 blocked.** Attacks 1 and 2 were refused when the chain checked them for admission, so they never entered a block; the hashes in [docs/qday-drill.md](docs/qday-drill.md) are the transactions' own hashes, for reference.

## 2. The on-chain verifier

`CistaVerifier` rebuilds the exact text the employer signed in QoreX, reads the employer's ML-DSA-87 key from the PQC Key Status precompile (`0x…0a02`) and checks the signature with the PQC Verify precompile (`0x…0a01`); then it checks every shown field against the run root. It has no storage, no owner and no admin, and it reverts (`PrecompileInactive`) instead of passing when a precompile isn't there.

Live, from [`packages/contracts/scripts/deploy.ts`](packages/contracts/scripts/deploy.ts):

| Check | Result |
| --- | --- |
| `verifyRun` on a real pay run signed in QoreX (run `47f10efc…649f`, paid in fUSD) | Verified on chain, employer `0x0457…3226`, 333,239 gas |
| The same run with the total raised by one unit | `revert BadSignature` |

Local EVM (ethereumjs, precompiles stood in by mocks that accept only the exact key, signature and message a real ML-DSA-87 signature covers): statement text byte-for-byte equal to the TypeScript library; commitments and Merkle roots equal; refused: raised total, unregistered employer, missing precompiles, raised net pay, band flipped from "no" to "yes", a field from another payslip, a missing employee address, an out-of-range index, a payslip moved to another position, bad bech32 checksums, other prefixes and lengths.

## 3. Malicious server (A3) and harvest now, decrypt later (A2)

| Attempt | Defence | Test |
| --- | --- | --- |
| Read payslips from a database dump | Only QoreSeal envelopes are stored (ML-KEM-1024 + X25519, AES-256-GCM); no name or amount appears in the database | `apps/server/test/app.test.ts` "stores ciphertext only" |
| Learn salaries from envelope sizes | Plaintext padded to 2,048-byte blocks; envelopes of different salaries are the same size | `packages/core/test/seal.test.ts` |
| Learn who an envelope is for | Envelopes are anonymous (no recipient hints) | `seal.test.ts` |
| Swap in the server's own key in an employee's key card | Cards are signed by the employee's ML-DSA-87 key and name the ML-KEM key's SHA3-256; the employer's browser checks both against the chain | `app.test.ts` "swapped ML-KEM key", `apps/web/src/lib/payrun.ts` |
| File Ada's envelope under Bayo, or move it to another run or period | The envelope's additional data binds chain, employer, period, employee and run root; it won't open | `seal.test.ts` |
| Serve a payslip that isn't the one the employer signed | Every payslip is checked against the signed run root on opening | `seal.test.ts` "not part of the signed pay run" |
| Record a fake payment | The server checks the payment on chain; the proof page checks it again itself | `app.test.ts`, `packages/core/test/payment.test.ts` |
| Upload a pay run the employer didn't sign | Checked against the employer's registered ML-DSA-87 key | `app.test.ts` |

A hacked server can still withhold payslips, or change the web app it serves (see Limitations).

## 4. Dishonest employee (A4), dishonest verifier (A5), curious colleague (A6)

| Attempt | Result | Test |
| --- | --- | --- |
| Raise net pay by one cent, rename a field, use a wrong salt, move a field to another position | Refused | `packages/core/test/disclose.test.ts`, `verify.test.ts`, contract tests |
| Splice a colleague's higher net pay into your own proof | Refused: the fields lead to two different payslips | `disclose.test.ts`, contract tests |
| Flip "net pay at least $3,000: no" to "yes" | Refused | contract tests |
| Show a proof made for one verifier to another | The proof names its recipient in the signed text; the page shows "Made for … If that isn't you, don't rely on it" | `packages/core/test/sign.test.ts` |
| Push back the expiry | Refused: the expiry is signed | `sign.test.ts` |
| Use a proof after it expires | Refused | `sign.test.ts` |
| Pass off a colleague's proof as your own | Refused: the employee who signs must be the payslip's employee | `sign.test.ts`, `verify.test.ts` |
| Open a colleague's payslip with your key | Refused | `seal.test.ts` |

## 5. In the browser

- Strict Content-Security-Policy: scripts, styles and connections only to the site itself; no framing; no referrer. Checked with the policy in force in a real browser.
- The sealing key comes from a 24-word recovery phrase (QoreSeal's BIP-39 derivation), shown once. A password locks a copy (Argon2id, 64 MiB, 3 passes, RFC 9106; AES-256-GCM; bound to the account's address; vaults made earlier with PBKDF2-SHA-256 at 600,000 rounds still open and are re-locked with Argon2id on the next unlock; a backup edited to ask for absurd Argon2 settings is refused before any work); while in use it stays unlocked in the tab only, wrapped by a non-extractable WebCrypto key, and locks after 30 minutes idle.
- The phrase is never sent to the server; the recovery form turns off autocomplete and spellcheck. Three of its words are asked back before set-up finishes.
- New passwords are scored by a small estimator that discounts common passwords, repeats, keyboard runs and the account's own address; weak ones are refused.
- Passkey unlock (optional) uses the WebAuthn PRF extension with user verification; HKDF-SHA-256 turns the secret into the AES-256-GCM key that wraps the seed, bound to the account. Checked in Chromium with a virtual authenticator: round trip, another account refused, no seed in storage, a clear error for passkeys without PRF. A new or recovered key removes the old passkey.
- Accessibility: axe-core (WCAG 2.1 AA and best practices) finds no issues on any page in either theme.
- A proof of pay travels in the link's `#fragment`, which browsers don't send to the server.

## Findings

Five findings came up while building and testing. All are fixed. None let an attacker read a payslip or pass a false proof.

| | Finding | Fix |
| --- | --- | --- |
| F-1 | QoreX refuses `MsgRegisterKEMKey` from websites ("managed by the wallet itself"), so an employee's ML-KEM key can't go in the chain's KEM registry from Cista. | Keys are published in a QoreSeal recipient card signed with the employee's registered ML-DSA-87 key, carrying the ML-KEM key's SHA3-256; the full key travels with it and is checked against the hash. A registry key is still used when an account has one and no card. |
| F-2 | A forgotten password lost the key, and with it every payslip. | 24-word recovery phrase (the model Proton uses for data recovery); employer re-seal for an employee who loses both. |
| F-3 | A proof page showing "₦2,685" or "$2,685" depended on the employee choosing to show the currency. | The currency is now always part of a proof. |
| F-4 | The QoreChain SDK reports PQC refusals under unrelated generic names ("mempool is full", "transaction is too large") because the codes overlap the Cosmos SDK's. | The drill reports the chain's own reason. Worth raising with the SDK's maintainers. |
| F-5 | Re-seal failed silently when the employer had also replaced their key. | By design nobody can open those payslips any more; the app now says why and what to do (recover the old key with its phrase). |

## Limitations

- **Payment amounts are public.** Like every transfer on chain, the fUSD paid to an address is visible (Zama and Bron's FHE payroll hides the amount but has no payslip; Cista is close to the mirror image). Someone who knows an employee's address can match it to net pay. What stays sealed: who the employee is, gross pay, tax, deductions, role and personal details. A fresh payout address per run would weaken that link; it is not built.
- **Metadata.** The server knows which addresses an employer pays and when, and a signed run's statement (employer, period, number of payslips, total) is public at `/api/runs/<root>`.
- **The browser is the trust boundary.** A hacked server could serve a changed web app that leaks keys or phrases. Every web app has this limit; the on-chain verifier lets a verifier's own contract check a proof without the web app.
- **The proof page reads the chain through the site's relay**, which could lie to it. `CistaVerifier` checks the same proof on chain.
- **Pay bands are fixed in advance** (23 bands from $250 to $50,000 a month). Proving any range at all would need a zero-knowledge range proof.
- **Lost both keys, lost the payslips.** If both the employee and the employer lose their keys and phrases, no one can open those payslips. That is the point of the sealing.
- **Cryptography libraries.** QoreSeal is "pending external review before 1.0", per its own README.

## Open items


- A fresh payout address per pay run.
- An external review.
