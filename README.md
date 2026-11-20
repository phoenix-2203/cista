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
| Core library (`packages/core`) | Built: payslip model, field commitments, pay-run fingerprint, sealing, signatures, payment check, proof of pay. 139 tests |
| Server (`apps/server`) | Built: sign-in, recipient cards, pay runs, payments, employee inbox. 24 tests |
| Web app | Next: employer pay run, employee inbox, lender check page |
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

The server takes `CISTA_PORT`, `CISTA_DB`, `CISTA_DOMAIN`, `CISTA_REST` and `CISTA_CHAIN_ID` from the environment. It needs no keys or secrets: it signs nothing.

## Licence

MIT
