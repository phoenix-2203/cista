# Team pay run, 2026-11-21

Run with `pnpm --filter @cista/contracts team:run` from a throwaway testnet account (see [the script](../packages/contracts/scripts/team-run.ts)). Three fresh employee accounts, payslips with pay frequency and year-to-date totals, the run signed with ML-DSA-87, one hybrid-signed `MsgMultiSend` for the whole team, each payslip opened only by its owner, and `CistaVerifier` checking an "earned this year" proof for each person.

One hybrid-signed `MsgMultiSend` paid a team of 3 on qorechain-diana: tx [`B3D87ED1523C4764B66B7B8293142E187FE3DF5519BEAE9A28DD02589BD85F7B`](https://explore.qore.network/tx/B3D87ED1523C4764B66B7B8293142E187FE3DF5519BEAE9A28DD02589BD85F7B), block 10510091, run root `c3fc940244a473b4fddc3723a2629909dba37e7315cab3583ea720940b33782e`.

**16 of 16 checks passed.**

| Check | Result | Detail |
| --- | --- | --- |
| Build, sign and seal | pass | 3 payslips, run root c3fc940244a473b4fddc3723a2629909dba37e7315cab3583ea720940b33782e, total 60000 uqor, each sealed to its employee and the employer |
| Pay the whole team in one transaction | pass | MsgMultiSend with 3 outputs, hybrid-signed, tx B3D87ED1523C4764B66B7B8293142E187FE3DF5519BEAE9A28DD02589BD85F7B |
| The chain's record pays exactly the signed run | pass | block 10510091; memo carries the run root; employer's ML-DSA-87 signature verified by the chain; 3 transfers totalling 60000 uqor |
| Ada Obi was paid | pass | 10000 uqor at qor168yduth9d3hksddsd54qjt06v9gw9wn40yeg4h (expected 10000) |
| Bayo Adeyemi was paid | pass | 20000 uqor at qor1609vt3lsra6xlg73sslacwykgwjjmr0ua0tccg (expected 20000) |
| Chidi Okeke was paid | pass | 30000 uqor at qor15pvnc5q0nej9rmqfys5du5qnhz0amyqgfl9cp8 (expected 30000) |
| Ada Obi opens their payslip | pass | net 250000 cents, year to date 2750000 cents, frequency monthly |
| Ada Obi can't open Bayo Adeyemi's payslip | pass | refused |
| Bayo Adeyemi opens their payslip | pass | net 300000 cents, year to date 3300000 cents, frequency monthly |
| Bayo Adeyemi can't open Chidi Okeke's payslip | pass | refused |
| Chidi Okeke opens their payslip | pass | net 350000 cents, year to date 3850000 cents, frequency monthly |
| Chidi Okeke can't open Ada Obi's payslip | pass | refused |
| The employer reopens its own copies | pass | Ada Obi monthly, Bayo Adeyemi monthly, Chidi Okeke monthly |
| On chain: Ada Obi earned at least $25,000 this year | pass | CistaVerifier 0xF26924d19029d1F1A253a3e079b16fD68B8519d8 accepted the proof and named employer 0x7448BF4A7963E81AB4f93B118159A91b7caD9b22 (qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh) and employee 0xD1C8dE2EE56c6F6835B06D2A092DFa6150E2ba75 (qor168yduth9d3hksddsd54qjt06v9gw9wn40yeg4h) |
| On chain: Bayo Adeyemi earned at least $25,000 this year | pass | CistaVerifier 0xF26924d19029d1F1A253a3e079b16fD68B8519d8 accepted the proof and named employer 0x7448BF4A7963E81AB4f93B118159A91b7caD9b22 (qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh) and employee 0xd3caC5c7F01f746fa3d1843fdc389643a52d8DfC (qor1609vt3lsra6xlg73sslacwykgwjjmr0ua0tccg) |
| On chain: Chidi Okeke earned at least $25,000 this year | pass | CistaVerifier 0xF26924d19029d1F1A253a3e079b16fD68B8519d8 accepted the proof and named employer 0x7448BF4A7963E81AB4f93B118159A91b7caD9b22 (qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh) and employee 0xa0593c500f9e6451EC092428DE5013B89FDd9008 (qor15pvnc5q0nej9rmqfys5du5qnhz0amyqgfl9cp8) |
