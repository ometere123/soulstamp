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

## Unified EAS compatibility correction — live evidence and replacement gate

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

The corrected V4.2 implementation now strictly checks the chain, EAS and
Registry code, UID, schema, resolver, permitted attester, recipient, timestamps,
revocation, scorer, numeric precision, threshold, passing flag, bounded stamp
array, and evidence commitment. Each validator independently retrieves the same
decision-critical facts before a snapshot is accepted. The legacy decoder path
remains available for records it can genuinely verify.

The deployed pre-correction V4.2 source is
`soulstamp-v4.2-unified-passport-compatibility` with LF-normalized SHA-256
`c49fe8d5eb0f7f9771fb0a6c47c218c74c79d48e2aded5c664f1f573e556d5f4`. It is
deployed at `0xFdb126147cE5DFD9Cb461079d77cae5803E7E7F2` on Studionet `61999`,
but that deployment is marked ABI-incompatible for unified evidence. The
corrected source is deployed at
`0xF3B64cD356D9c67144f77e167ee0D02B3a760a3c`, bound to fresh Arc escrow
`0x53eeb55fcb5253d6640a5db8c3a7bea9deb9316f`. The deployment receipt remains
`FINALIZED`, `MAJORITY_AGREE`,
`FINISHED_WITH_RETURN`, and successful execution for the old source, but this
does not prove corrected unified refresh behavior.
The earlier V4.2 pair with an empty Google issuer was superseded before any
user state was created and is retained separately in the live ledger.

The frontend no longer treats a globally configured UID as an ordinary identity
source. On opening a TrustPass request it derives the subject from the connected
wallet and calls the existing Worker discovery route. That route uses the
Passport v2 API only for informational score/stamp status and the operational
Optimism Sepolia EASSCAN GraphQL indexer only to locate candidate UIDs. It
returns no API key and no raw provider secret. The browser then performs the
existing direct EAS validation and pins a block. Only after that validation does
the user see **Attach verified Passport**; after the finalized GenLayer write,
the frontend reads `get_humanity_evidence(request_id)` and checks the wallet and
UID before showing **Verified for this request**.

The configured API scorer is `12174`, not approved scorer `335`, so its API score
is explicitly informational. The deployed Worker returned a live EAS candidate
for the known wallet but its API upstream was unavailable from the Worker
runtime; the local configured API request returned HTTP 200. This does not
weaken the on-chain path. The operational indexer host is
`https://optimism-sepolia.easscan.org/graphql`; the bedrock hostname listed in
some EAS documentation did not resolve during the release check. Indexer data
is never authoritative and older candidates are not silently substituted for a
newer candidate.

The full read-only record is in
[`artifacts/live/v4-unified-passport-readiness.json`](../artifacts/live/v4-unified-passport-readiness.json).

## Current read-only audit

At the original Optimism Sepolia pinned read, the legacy decoder at
`0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56` returned `0x120a2e77` for the
unified UID because it is configured for historical schemas. The EAS record is
valid and the corrected V4.2 adapter is deployed at
`0xF3B64cD356D9c67144f77e167ee0D02B3a760a3c`; no live
`refresh_humanity_evidence_unified` transaction is claimed by this integration
release because the user must approve that write manually.

The earlier read was at Optimism Sepolia block `50307497` (hash
`0x33d845abf8cf74181cd38fd5d0c56f0533386c95a9f047f02dbd03070386c5ab`), where
the decoder had bytecode and the RPC reported chain `11155420`. The live V4.2
refresh still requires the subject wallet to approve the request-bound write.
Automatic discovery supplies the UID and a stable block internally after direct
validation; a different wallet’s score must never be substituted.
