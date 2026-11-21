# Q-Day drill: live results

Run 2026-11-21T16:43:01.256Z against cista.duckdns.org and qorechain-diana by `pnpm --filter @cista/contracts qday:drill`.

Victim (classical key stolen): `qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh`. Attacker: `qor1f8e325q8t4cprkfergt53l7pvx89ugvsafrmmc` with a fresh ML-DSA-87 key.

| # | Target | Attempt | Expected | Actual | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | Chain | Pay the attacker with a Cista-style multi-send, signed with the stolen classical key only | refused: the account has a registered PQC key | refused by the chain: "pqc account qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh has a registered PQC key and must include the hybrid signature extension (hybrid mode: required): hybrid PQC signature required" (tx 71923BFE938DAEA859C58BD5769A3EB73C318BD5D780CA787432D580116378AD) | Blocked |
| 2 | Chain | Same payment, hybrid-signed with the attacker's own ML-DSA-87 key | refused: the ML-DSA-87 layer doesn't match the registered key | refused by the chain: "pqc PQC signature verification failed for qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh: hybrid PQC signature verification failed" (tx A5D071EC37A98A1B3B71A97B77F15B0971AC67615D1D1ED00AC1807BE04E79A3) | Blocked |
| 3 | Cista server | Sign in as the victim with the stolen classical key only | 401 | HTTP 401: sign-in needs the ML-DSA-87 signature, not only the classical one | Blocked |
| 4 | Cista server | Sign in as the victim, hybrid-signed with the attacker's own ML-DSA-87 key | 401 | HTTP 401: the sign-in signature does not verify against this account's registered keys | Blocked |
| 5 | Cista server | Publish a key card for the victim (to have payslips sealed to the attacker), without a session | 401 | HTTP 401: sign in first | Blocked |
| 6 | Cista server | Read the victim's sealed payslips without a session | 401 | HTTP 401: sign in first | Blocked |
| 7 | Proof of pay | A forged proof of "at least $25,000 a month" from the victim employer, signed by the attacker's own (registered) account, pointing at a real Cista payment | refused at the employer's signature | refused at "employer": the pay run signature does not verify against qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh's registered ML-DSA-87 key | Blocked |
| 8 | CistaVerifier | The same forged run submitted to the on-chain verifier | revert BadSignature | revert BadSignature | Blocked |

**8 of 8 attacks blocked.**
