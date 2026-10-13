# SoulStamp v3 milestone

SoulStamp v3 extends the existing single-principal contract rather than replacing the product. v1 established wallet-to-account proof; v2 added structured proof health and reverification. v3 adds an enforceable continuity lifecycle around those proofs.

## Protocol boundary

The contract is authoritative for:

- normalized platform ownership and canonical-ID uniqueness;
- evidence freshness, one-use Discord attestation tokens, and status/`is_active` consistency;
- challenge deadlines, rebuttals, independent GenLayer resolution, recovery authorization, and eligibility;
- append-only audit events with a hash chain; and
- explicit v2 migration with a configured legacy contract address.

X/Twitter submitted URLs are locators only. The contract validates the exact claimed status URL and derives authorship from the fetched provider HTTPS `author_url` and exact handle. X oEmbed does not currently return an immutable author ID, so this is recorded as medium-strength handle-only evidence and cannot authorize full-principal recovery.

## Challenge and recovery state machine

```text
OPEN
  -> AWAITING_REBUTTAL       challenger evidence passes precheck
  -> EXPIRED                  no challenger evidence before the deadline
  -> RESPONDED                owner submits bounded rebuttal
  -> RESOLVED_OWNER           owner evidence is upheld
  -> RESOLVED_CHALLENGER      challenger evidence is upheld
  -> RESOLVED_INCONCLUSIVE    fresh evidence conflicts
  -> EXECUTED                 challenger completes recovery after delay
```

Resolution requires challenger evidence and either a rebuttal or an elapsed
30-minute deadline. The resolver independently fetches both evidence URLs and
validators must agree on the material outcome. Recovery has a safety delay and
can only be executed by the winning challenger into a wallet without an
existing identity. Recovery is account-scoped: the challenged account and its
challenge history move to a new principal, while unrelated links and
reputation remain with the source identity. An unanswered `OPEN` challenge can
be expired by any caller after the deadline, and a later challenge attempt also
performs this bounded cleanup so an abandoned challenge cannot permanently lock
a link.

## Eligibility

Consumers should call `consumer_eligibility(wallet)` immediately before
granting access. Eligibility requires identity state `ACTIVE`, no admin flag,
and at least one proof with status `ACTIVE`, `is_active == true`, and
`evidence_expires_at >= now`. `ACCEPTED` or `FINALIZED` transaction status is
not itself evidence of successful execution; clients require the execution
result `FINISHED_WITH_RETURN` before reading the resulting state.

## Existing-user continuity

Redeployment does not silently abandon v2 users. The new constructor accepts a
legacy contract address. An admin explicitly calls `migrate_legacy_identity`
for each legacy wallet after inspecting the legacy registry. The migration
imports supported links and canonical IDs, marks imported proofs as `STALE` with
reason `MIGRATED_REQUIRES_REVERIFICATION`, reserves non-revoked canonical indexes
to prevent takeover during migration, and records the source contract in an
immutable audit entry. Legacy state remains untouched and can
be compared against the new record. Imported proofs with no fresh evidence are
not consumer-eligible until reverification.

## Gates and honest live evidence

Required pre-deployment gates are:

1. repository-local GenLayer CLI `0.39.1` installation;
2. `genvm-lint lint` plus semantic `genvm-lint check` with the pinned runner;
3. Direct Mode positive, negative, replay, conflict, recovery, and adversarial validator tests;
4. frontend production build and Discord Worker syntax check; and
5. optional real Studionet integration reads/writes with `tx_execution_succeeded`.

`scripts/live_studionet_proof.py` is fail-closed. It records a lifecycle step
only after a separate SDK finality inspector confirms `FINALIZED` and
`FINISHED_WITH_RETURN`, and it refuses to record a deployment when exact source
parity fails. After deployment it also submits a deliberately invalid recovery
transition and records it only when the transaction is finalized with a
terminal failed execution. Additional verification, challenge, rebuttal,
recovery, revocation, and eligibility steps remain explicit operator inputs so
missing external evidence, locked accounts, rate limits, or failed transactions
are reported as blockers rather than converted into success claims.

## Consensus regression hardening

The v2 implementation is available in repository history at `4b6d773` and
compared the LLM-supplied `reason_code` and `proof_status` as consensus fields,
with a confidence tolerance of 15 points. The v3 implementation added canonical
IDs and stricter source checks but originally retained the same exact reason-code
comparison. The current fix derives protocol `reason_code` from deterministic
code, account, and freshness facts; LLM reasoning remains explanatory only.
Validators still independently fetch and validate the source, canonical ID, and
account binding, and confidence remains bounded to a 15-point tolerance.

Two public live v3 receipts were inspected before this fix:

- `0x7c325c00b56c85101695119eee1ea9e0fa6def3aa9cf93bbd2fa1124b3041dd`
- `0x00392105e75112406a3ea9f90d057c79da55ef1769cd52b1330d1a39e5bbb6ab`

Both were `FINALIZED` with leader execution `SUCCESS` but consensus result 7,
`MAJORITY_DISAGREE`. The public leader payloads showed matching canonical ID,
code, account match, and active status, but used different reason labels
(`OK` and `EXACT_CODE_AND_ACCOUNT_MATCH`). That is direct evidence of harmless
label variance and disagreement; the exact dissenting validator payloads are
not available because Studionet returned `MethodNotFoundRpcError` for
`gen_dbg_traceTransaction`. The validator disagreement is therefore not
claimed as a fully traced causal proof. Regression tests cover wording/reason
variance, HTTP source failures, canonical-ID changes, replay, invalid challenge
decisions, misleading finality receipts, and exact signer/method/argument
metadata.

## Previous verified deployment handoff (superseded)

The corrected v3 revision was deployed by the operator and independently
verified from the public Studionet RPC:

- Commit: `b291e6091d0025102c75874501d625ea63855d23`
- Contract: `0xa3B01Cf1512734C7747e75520751BC2220880041`
- Deployment: [0x93a2177a733f2a0851abde6fb053289d363c05dc03d08afccdd72c7e388cb949](https://explorer-studio.genlayer.com/tx/0x93a2177a733f2a0851abde6fb053289d363c05dc03d08afccdd72c7e388cb949)
- Receipt: `FINALIZED`, `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, raw
  executions `SUCCESS`, `SUCCESS`
- Source parity: exact after CRLF normalization; normalized SHA-256
  `b46addab5800fab8d87d7019efb76866b13e15644d3b7b4361fb3435c35d96bf`.
  The API's CRLF-preserving raw SHA-256 is
  `b9a9c57940d48881f693592b89fa494b918f50722c27318f220ea170c76f292b`.
- Initial state: verifier `soulstamp-v3.0-continuity`, configured admin
  `0x4e44636494650386b89c64011c10f48d4b344c4f`, legacy contract
  `0x3108daffcbc24e261137056c56afcae17677bdfb`, and zero verifications,
  identities, challenges, and recoveries.
- Vercel Production and Preview both report `READY`; their public bundles
  contain the new address and not the superseded v3 address.

Lifecycle proof is intentionally still `not_recorded`. Real social
verification, challenge, rebuttal, recovery, revocation, eligibility, and
negative-transition transactions remain operator-owned and are not implied by
deployment finality.

## Current verified deployment handoff

The compatibility-fixed revision was deployed by the operator and independently
verified from public Studionet 61999 data:

- Commit: `59e62828bd34912d18463837ec9cbf5e78d0ec68`
- Contract: `0x279003ad03E224e26C328466135Ac83a1AC8ED8a`
- Deployment: [0xc4fbdcbea4a01fc12a6fd4f8a0e392e2e3cbc8fb83be1a1fa8365f58a4b19119](https://explorer-studio.genlayer.com/tx/0xc4fbdcbea4a01fc12a6fd4f8a0e392e2e3cbc8fb83be1a1fa8365f58a4b19119)
- Signer: `0x4e44636494650386b89c64011c10f48d4b344c4f`
- Receipt: `FINALIZED`, `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, raw
  executions `SUCCESS`, `SUCCESS`.
- Source parity: exact after CRLF normalization; normalized SHA-256
  `b2d04d220e62f96a6877bddc9e076c44857b546095b4341eda6670635303b0a2`.
  The API raw source SHA-256 is
  `46655b43d6e15545f42b2602f8fca1d37bce0e3f0de80c9604e17e4864534e5c`.
- Initial state: verifier `soulstamp-v3.0-continuity`, admin
  `0x4e44636494650386b89c64011c10f48d4b344c4f`, legacy contract
  `0x3108daffcbc24e261137056c56afcae17677bdfb`, and zero verifications,
  identities, challenges, and recoveries.
- Vercel: production `dpl_7FnBQ8Ny2huSNKrPdxi12ZmqsXfD` and preview
  `dpl_29LikYPv5eUEdnMBfADJP1DKJC5W` are both `READY`; verified bundles
  contain the new contract and not the prior v3 address.
- Discord Worker: existing Worker updated in place from this commit; current
  version `68358f76-9982-4bb6-ab4b-dc22eea88bfa`, health endpoint `ok: true`.

The Discord attestation backend is configured by finalized admin transaction
[0xdb54b28ed5645d5599d61fe116a2d612d1e3ce00019aabcde17b37e0a8106582](https://explorer-studio.genlayer.com/tx/0xdb54b28ed5645d5599d61fe116a2d612d1e3ce00019aabcde17b37e0a8106582),
which called `set_discord_attestation_base_url("https://soulstamp-discord.delealufejoel.workers.dev")`.
It reached `FINALIZED / MAJORITY_AGREE / FINISHED_WITH_RETURN` with
`SUCCESS`, `SUCCESS`, and `get_stats` confirms the stored Worker URL.

Lifecycle proof remains intentionally `not_recorded`; real social verification,
challenge, rebuttal, recovery, revocation, eligibility, and negative-transition
transactions remain operator-owned.
