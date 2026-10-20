# Human Passport evidence

V4 reads the Optimism Sepolia decoder
`0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56` on chain `11155420` through
`eth_chainId`, `eth_getCode`, `eth_getBlockByNumber` and `eth_call`. The call is
the documented `getScore(address)` selector `0xd47875d0`; the requested wallet
is always the V4 subject wallet and is not supplied as a separate user score.

The raw decoder result uses four decimal places. Therefore:

```text
raw 199999  -> 19.9999 -> threshold 20 not met
raw 200000  -> 20       -> threshold met
raw 200001  -> 20.0001  -> threshold met
```

Validators compare the normalized chain, decoder, subject, pinned block hash,
block timestamp, ABI word and raw score. A wrong chain, decoder, wallet,
malformed response, missing code, reverted call, stale block or RPC
disagreement fails closed. The decoder does not provide an original score
issuance timestamp; V4 records the observation and block timestamps and uses a
seven-day refresh window. Users can refresh through the real decoder read and
the GenLayer `refresh_humanity_evidence` write.

Users without on-chain Passport evidence must use the official onboarding or
test-mode instructions at <https://app.passport.xyz> and the Human Passport
documentation. Test-mode evidence must be labelled as testnet evidence; V4
does not synthesize scores.

## Unified EAS compatibility correction — deployed V4.2

The current Human Passport record for the SoulStamp subject wallet is a valid
unified EAS attestation, not a legacy decoder record. Its independently read
facts are:

- Optimism Sepolia `11155420`, EAS `0x4200000000000000000000000000000000000021`;
- recipient `0xFd69A5D0b8330dC86e266304B3D1ABE3F57b9D09`;
- attestation UID
  `0x65843ca97b6f8133713feeff548173b64cb5c7bf98839e68f77c701fb6d17813`;
- schema UID
  `0x81d8758ccd97bbeea7642df29001f6046a676b3c24f808c4297db5ee36838dd8`;
- permitted attester `0x8B1A76795e3CbadD79C5410d2C4D4827D9C1503a`;
- Schema Registry resolver `0xa2c832b63A20C06CCc2Ca31c12b8248452729a4D`;
- scorer `335`, raw score `446980`, four decimals (`44.6980`), raw threshold
  `200000`, `passing_score=true`;
- created at `2026-10-19T13:06:08Z`, expires at
  `2027-01-17T13:05:57Z`, and no revocation was reported at the pinned read.

The official legacy decoder at
`0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56` still points at historical
Passport schemas. Its documented `getScore(address)` read returns
`0x120a2e77` (`AttestationNotFound`) for this current unified record. That is a
confirmed compatibility defect in the deployed reader, not a reason to reject
the EAS attestation or to substitute a user-entered score.

The two-argument legacy lookup `getScore(uint256,address)` was also tried with
approved scorer ID `335` and this subject wallet; the deployed decoder returned
the same `0x120a2e77` (`AttestationNotFound`). It therefore cannot be used as a
compatibility bridge for the unified record.

The deployed V4.2 source adds `refresh_humanity_evidence_unified`, which reads the
complete EAS `getAttestation(bytes32)` record and the Schema Registry at one
pinned block. It strictly checks the chain, EAS and Registry code, UID, schema,
resolver, permitted attester, recipient, timestamps, revocation, scorer,
numeric precision, threshold, passing flag, bounded stamp array, and evidence
commitment. Each validator independently retrieves the same decision-critical
facts before a snapshot is accepted. The legacy decoder path remains available
for records it can genuinely verify.

The V4.2 source is `soulstamp-v4.2-unified-passport-compatibility` with
LF-normalized SHA-256
`c49fe8d5eb0f7f9771fb0a6c47c218c74c79d48e2aded5c664f1f573e556d5f4`. It is
deployed at `0xFdb126147cE5DFD9Cb461079d77cae5803E7E7F2` on Studionet `61999`
with exact remote/local parity, `FINALIZED`, `MAJORITY_AGREE`,
`FINISHED_WITH_RETURN`, and successful execution. Its fresh Arc escrow is
`0x686f8ab8ce08512af72ab26c78a98a23ea8b71be`, bound once to that V4 address.
The earlier V4.2 pair with an empty Google issuer was superseded before any
user state was created and is retained separately in the live ledger.

The full read-only record is in
[`artifacts/live/v4-unified-passport-readiness.json`](../artifacts/live/v4-unified-passport-readiness.json).

## Current read-only audit

At the original Optimism Sepolia pinned read, the legacy decoder at
`0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56` returned `0x120a2e77` for the
unified UID because it is configured for historical schemas. V4.2 now reads
the unified EAS record directly. The authenticated subject attestation is
therefore compatible with the deployed V4.2 adapter, but the subject has not
yet submitted a live `refresh_humanity_evidence_unified` transaction.

The earlier read was at Optimism Sepolia block `50307497` (hash
`0x33d845abf8cf74181cd38fd5d0c56f0533386c95a9f047f02dbd03070386c5ab`), where
the decoder had bytecode and the RPC reported chain `11155420`. The live V4.2
refresh still requires the subject wallet to submit the attestation UID and a
stable block number; a different wallet’s score must never be substituted.
