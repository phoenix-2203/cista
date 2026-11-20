# How AI was used to build Cista

Cista is built by one person, [phoenix-2203](https://github.com/phoenix-2203), working with **Claude** (Anthropic, Claude Opus 5.5) in the Claude desktop app's Cowork mode. This file says plainly what the AI did, what the human did, and how the work is checked. It grows with the project.

## Tools

| Tool | Used for |
|---|---|
| Claude (Cowork mode) | Research, idea and name checks, writing the code, tests and docs, small commits |
| Claude's browser pane | Reading the fest's site and testnet data (for example a real hybrid-signed transfer, to get the payment format right) |
| QoreX browser extension (human) | Every real signature. The human checked which QoreX features are available (`signArbitrary` is) |

No AI service is called at runtime. Cista has no model and no API key.

## Who did what

| Step | Human | AI |
|---|---|---|
| Idea | Chose confidential payroll for Encrypted Apps, a second entry that must not overlap with his Quantum Pass entry, Unyoke. Asked for a design strong enough to beat the best entry in the track. | Read the competing entries (Whisper, TravelSeal, DeadDrop, Quorate and others) and proposed the upgrade: proof of pay with selective disclosure, tied to the real payment. |
| Name | Picked **Cista** after rejecting many AI-sounding names. | Checked each candidate for clashes in payroll, crypto and the fest. |
| Decisions | Chose a server on his own VPS holding ciphertext only, one transaction paying the whole team, and the employer, employee and auditor as readers. | Laid out the options with their trade-offs. |
| Code | Reviews the work and pushes every commit himself. | Writes the TypeScript: the core library (payslip model, commitments, Merkle tree, sealing, signatures, payment and proof checks) and the server. |
| Writing | Set the README's requirements. | Writes the README, this file and the fest form text. |

## How the AI's work is checked

- **Tests and types on every change:** `pnpm test` and type checks before each commit (163 tests so far).
- **Independent test vectors:** the pinned commitment and Merkle root values were recomputed in Python, separately from the TypeScript code.
- **Attacks in the tests, not just happy paths:** a one-kobo change, fields spliced from another payslip, envelopes filed under the wrong employee, classical-only signatures (what a stolen ECDSA key can make), forged signers, payments that pay less than signed.
- **Small, reviewable commits**, pushed one by one, at the human's request.

## Safety rules the AI follows

- It never asks for, sees or handles a seed phrase or private key. Every real signature is made by the human in QoreX.
- Tests use random in-memory keys and made-up addresses that hold nothing.
- It makes no on-chain transaction without the human's go-ahead.
