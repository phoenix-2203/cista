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

## Licence

MIT
