# Cista

Sealed payroll on QoreChain: everyone gets paid, only you see your payslip.

Cista runs payroll on the QoreChain testnet (`qorechain-diana`):

- **Sealed payslips.** Each payslip is sealed in the browser with ML-KEM-1024 (QoreSeal) to the employee's key in QoreChain's PQC registry. The server stores ciphertext only.
- **One payment, one fingerprint.** A single hybrid-signed (secp256k1 + ML-DSA-87) transaction pays the whole team and carries the pay run's fingerprint in its memo.
- **Proof of pay, without the payslip.** An employee can show a lender one fact (net pay, employer, "salary above ₦X") and keep the rest sealed. The lender checks it without a wallet.

Work in progress for QoreChain's Build Before Q-Day fest (Encrypted Apps). Testnet only.

## Licence

MIT
