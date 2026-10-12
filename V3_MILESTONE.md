# SoulStamp v3 milestone

SoulStamp v3 extends the existing single-principal contract rather than replacing the product. v1 established wallet-to-account proof; v2 added structured proof health and reverification. v3 adds an enforceable continuity lifecycle around those proofs.

## Protocol boundary

The contract is authoritative for:

- normalized platform ownership and canonical-ID uniqueness;
- evidence freshness, one-use Discord attestation tokens, and status/`is_active` consistency;
- challenge deadlines, rebuttals, independent GenLayer resolution, recovery authorization, and eligibility;
- append-only audit events with a hash chain; and
- explicit v2 migration with a configured legacy contract address.

X/Twitter submitted URLs are locators only. The contract validates the exact claimed status URL and derives authorship from the fetched oEmbed `author_url` and canonical author ID. This prevents a claimant from submitting a URL under the claimed handle that was authored by somebody else.

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
existing identity. The old identity is retained as `RECOVERED`; its audit
history is copied into the new principal record and the new active indexes are
reserved atomically. An unanswered `OPEN` challenge can be expired by any
caller after the deadline, and a later challenge attempt also performs this
bounded cleanup so an abandoned challenge cannot permanently lock a link.

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
