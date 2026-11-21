# How AI was used to build Cista

Cista is built by one person, [phoenix-2203](https://github.com/phoenix-2203), working with **Claude** (Anthropic, Claude Opus 5.5) in the Claude desktop app's Cowork mode. This file says plainly what the AI did, what the human did, and how the work is checked. It grows with the project.

## Tools

| Tool | Used for |
|---|---|
| Claude (Cowork mode) | Research, idea and name checks, writing the code, tests and docs, small commits |
| Claude's browser pane | Reading the fest's site and testnet data (for example a real hybrid-signed transfer, to get the payment format right); design research on Framer templates, Landdding, Godly, 60fps and FontInLogo, and on similar products (Zama's confidential payroll, Toku, Deel, Rise, Argyle, Mercury) |
| Playwright, axe-core, Lighthouse | Screenshots of every design sample; accessibility (WCAG 2.1 AA) and speed checks; passkey unlock tested with a virtual authenticator |
| QoreX browser extension (human) | Every real signature. The human checked which QoreX features are available (`signArbitrary` is) |

No AI service is called at runtime. Cista has no model and no API key.

## Who did what

| Step | Human | AI |
|---|---|---|
| Idea | Chose confidential payroll for Encrypted Apps, a second entry that must not overlap with his Quantum Pass entry, Unyoke. Asked for a design strong enough to beat the best entry in the track. | Read the competing entries (Whisper, TravelSeal, DeadDrop, Quorate and others) and proposed the upgrade: proof of pay with selective disclosure, tied to the real payment. |
| Name | Picked **Cista** after rejecting many AI-sounding names. | Checked each candidate for clashes in payroll, crypto and the fest. |
| Decisions | Chose a server on his own VPS holding ciphertext only, one transaction paying the whole team, and the employer, employee and auditor as readers. | Laid out the options with their trade-offs. |
| Code | Reviews the work and pushes every commit himself. | Writes the TypeScript: the core library (payslip model, commitments, Merkle tree, sealing, signatures, payment and proof checks) and the server. |
| Testnet | Ran the deploy script and the Q-Day drill on his Mac from a throwaway testnet account, and every real pay run, payslip and proof from QoreX. | Wrote `CistaVerifier`, its local-EVM tests, the deploy script and the drill; read the results back from the chain and wrote [audit.md](audit.md). |
| Design | Asked for a premium look and a light/dark mode; picked the logo direction (the seal dot) and the Oxblood palette from samples; asked for a fuller, smoother landing page after it looked empty; flagged the faded dark-mode button. | Researched templates and competing products (structure, type, colour, icons, glows, motion), drew the logo and colour samples, then built the theme, the wordmark and wax-seal mark, the landing page, the icons and the motion; checked accessibility and speed. |
| Product decisions | Asked for saving the team for next month, year-to-date and payslip details like other payrolls, passkeys, a phrase check, a strength meter and Argon2id; chose one QoreX account per company. | Compared Cista's payslip and key handling with other payrolls and with Zama/Bron, and recommended what to build and what to skip. |
| Live team run | Ran the team pay run script on his Mac (16 of 16, [docs/team-run.md](docs/team-run.md)). | Wrote the script, found and fixed its one bug (comparing the contract's 0x answer with qor1 text), and wrote up the result. |
| Writing | Set the README's requirements. | Writes the README, this file and the fest form text. |

## How the AI's work is checked

- **Tests and types on every change:** `pnpm test` and type checks before each commit (239 tests so far, plus a browser check of the proof page, a live Q-Day drill, a live team pay run and a live check of the contract; accessibility checked with axe-core on every page in both themes).
- **Independent test vectors:** the pinned commitment and Merkle root values were recomputed in Python, separately from the TypeScript code.
- **Attacks in the tests, not just happy paths:** a one-kobo change, fields spliced from another payslip, envelopes filed under the wrong employee, classical-only signatures (what a stolen ECDSA key can make), forged signers, payments that pay less than signed.
- **Live, not mocked, where it matters:** the contract was checked against a real pay run signed in QoreX, the Q-Day drill ran its 8 attacks against the live testnet and site ([docs/qday-drill.md](docs/qday-drill.md)), and a team of three was paid in one transaction with every payslip and an "earned this year" proof checked ([docs/team-run.md](docs/team-run.md)).
- **Small, reviewable commits**, pushed one by one, at the human's request.

## Safety rules the AI follows

- It never asks for, sees or handles a seed phrase or private key. Every real signature is made by the human in QoreX.
- Tests use random in-memory keys and made-up addresses that hold nothing.
- It makes no on-chain transaction without the human's go-ahead.
