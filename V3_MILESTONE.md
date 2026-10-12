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
reserved atomically.

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
imports supported links and canonical IDs, reserves only active indexes, marks
the imported proof as `MIGRATED_FROM_SOULSTAMP_V2`, and records the source
contract in an immutable audit entry. Legacy state remains untouched and can
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
