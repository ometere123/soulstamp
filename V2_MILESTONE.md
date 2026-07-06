# SoulStamp v2 Milestone

## Title

SoulStamp v2: GenLayer-Powered Identity Proof Health Protocol

## Milestone Summary

SoulStamp v2 turns the original one-time social identity verification app into an ongoing identity proof health protocol. The core upgrade is **Proof Health + Reverification**: GenLayer now verifies public proof, stores structured evidence, and rechecks whether linked identities remain `ACTIVE`, `STALE`, `CONFLICTED`, `REVOKED`, or `FLAGGED` over time.

This is meaningful new progress beyond the original accepted project because it adds new contract functionality, a new Discord OAuth attestation integration, stronger verification architecture, new frontend proof-health surfaces, and deployed fixes proven through manual testing.

## Baseline And Current Work

The visible repository history now shows the main v2 work after the initial SoulStamp implementation, including these commits:

```text
4b6d773 Upgrade SoulStamp proof health protocol
2000ca1 Fix pending proof label in verification flow
e907ce8 Fix proof health UI and Discord callback flow
2a03b5f Allow Discord callback before wallet connection
fd6d0a8 Persist wallet connection across refresh
4cc49a1 Expose Discord pending proof fields
```

## Contract Changes

- Added proof health states: `ACTIVE`, `STALE`, `REVOKED`, `CONFLICTED`, and `FLAGGED`.
- Added `reverify_platform` so GenLayer can re-check live public proof evidence for an already linked account.
- Replaced unsafe wall-clock-dependent verification code logic with deterministic pending proof IDs/codes based on caller, platform, username, and a nonce/counter.
- Added structured proof verdict storage instead of relying on loose LLM prose.
- Added proof dossiers with supporting evidence: platform, username, canonical ID where available, proof source, verification method, proof strength, risk band, confidence bucket, reason code, status, verifier version, wallet, and audit reference.
- Restricted proof fetch URLs so users cannot verify one platform using unrelated arbitrary pages.
- Added Discord attestation replay-awareness and stricter wallet/code/pending-proof matching.

## GenLayer Consensus Changes

- GenLayer now returns strict structured verdict fields such as `code_found`, `account_match`, `platform`, `username`, `proof_strength`, `risk_band`, `confidence_bucket`, `reason_code`, and `proof_status`.
- Critical fields are compared strictly across validators.
- Confidence is bounded instead of allowing open-ended LLM wording to decide contract state.
- GenLayer is used not only for first verification, but also for proof health rechecks.

## Proof Health And Reverification

SoulStamp v1 verified a social proof once. SoulStamp v2 maintains proof health over time.

- `ACTIVE`: live proof is currently confirmed.
- `STALE`: proof was valid before, but the latest recheck could not confirm it.
- `CONFLICTED`: evidence suggests ownership conflict or suspicious mismatch.
- `REVOKED`: the user removed/revoked the link.
- `FLAGGED`: admin marked the identity risky or abusive.

Reverification does not erase old proof history. It updates health and writes a new audit entry.

## Discord Backend Changes

- Moved Discord verification to a Cloudflare Worker.
- Added OAuth-backed Discord session handling.
- Worker issues short-lived signed attestation URLs that GenLayer validators can fetch.
- Attestations include wallet, verification code, pending proof ID, Discord user ID, claimed username, issuer, nonce, issued time, and expiry.
- Backend does not become the final verifier; it only issues OAuth-backed evidence for GenLayer consensus.

Live Worker:

```text
https://soulstamp-discord.delealufejoel.workers.dev
```

## Frontend Changes

- Added v2 product positioning around identity proof health.
- Added proof health badges and proof strength/risk display.
- Added proof dossier visibility.
- Added reverification actions.
- Improved public lookup by wallet and social account.
- Improved audit trail visibility.
- Fixed Discord callback handling before wallet connection.
- Added wallet persistence across refresh.
- Fixed proof-health UI spacing and pending proof labeling.

Live frontend:

```text
https://soulstamp-gen.vercel.app
```

## Tests And Verification

Checks run during the v2 work included:

```text
backend: npm.cmd run check
frontend: npm run build
contract: local structural/contract tests where available
live Worker health check: 200 OK
manual frontend/Discord verification flow: passed after Worker redeploy
manual read/write wiring: verified against Studionet with a signed transaction test
```


## Deployed Configuration

Frontend contract address:

```text
0x3108dafFCBC24E261137056c56aFCAE17677BDfB
```

Admin wallet observed from live contract stats:

```text
0x4e44636494650386b89c64011c10f48d4b344c4f
```

## Judging Angle

This milestone should not be judged as “more storage” or a UI refresh. The meaningful progress is that SoulStamp now uses GenLayer more deeply as an ongoing identity proof judge.

**SoulStamp v2 turns one-time social verification into an ongoing GenLayer-powered identity proof health protocol. GenLayer verifies public proof, structures the consensus verdict, stores evidence, and rechecks whether identity proofs remain active, stale, conflicted, revoked, or flagged over time.**

