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
  -> RECOVERY_CANCELLED       owner counter-evidence cancels pending recovery
  -> EXECUTED                 challenger completes recovery after delay
```

An `OPEN` challenge has a 30-minute challenger-evidence deadline. Once fresh
challenger evidence is independently accepted, the contract snapshots the
provider response, stores its SHA-256 hash and a commitment binding the
challenge, wallet, code, canonical ID, issuer, nonce, attestation ID, source
timestamps, and acceptance timestamp, then starts a separate 30-minute owner
rebuttal deadline. An unanswered `OPEN` challenge can be expired by any caller
after the challenger-evidence deadline.

Resolution independently derives facts rather than trusting the stored
precheck status. GitHub and X account/canonical evidence is revalidated from
the provider at resolution while the exact accepted code response remains
integrity-bound. Discord uses its accepted immutable snapshot, so a Worker
attestation may expire during the rebuttal window without making a valid
challenge unverifiable. Validators check code presence, wallet/account
binding, canonical-ID agreement, issuer/nonce/attestation metadata, and
snapshot integrity before accepting `OWNER_UPHOLDS`, `CHALLENGER_UPHOLDS`, or
`INCONCLUSIVE`.

Recovery has a safety delay and can only be executed by the winning challenger
into a wallet without an existing identity. Recovery is account-scoped: the
challenged account and its challenge history move to a new principal, while
unrelated links and reputation remain with the source identity. A stale
canonical proof keeps its platform and canonical reservations until this
fresh-evidence challenge process completes; stale records are never released
automatically. X handle-only proofs and legacy records without canonical IDs
remain outside recovery-grade challenge authorization.

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
imports every supported historical link, including records that have no
canonical ID, marks imported proofs as `STALE` with reason
`MIGRATED_REQUIRES_REVERIFICATION`, reserves the historical platform index and
any available canonical index to prevent takeover during migration, and records
the source contract in an immutable audit entry. Legacy state remains untouched
and can be compared against the new record. Imported proofs with no fresh
evidence are not consumer-eligible until reverification. Historical handle-only
records without a canonical ID remain stale and discoverable for
owner-controlled reverification, but migration never grants immutable-ID
ownership, fresh eligibility, or recovery authority. There is intentionally no
V3-to-V3 migration path; a newly deployed V3 instance starts empty and
requires fresh operator verification.

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
comparison. The current correction derives protocol status, reason code,
strength, risk, and confidence from deterministic code, account, canonical-ID,
and freshness facts; LLM reasoning remains explanatory only. Validators still
independently validate live provider data or the accepted immutable snapshot,
including account binding. Active policy
confidence is exactly `92` for GitHub, `82` for X handle-only, and `94` for
Discord, regardless of missing or contradictory LLM score fields. Direct Mode
also covers separate challenger/rebuttal deadlines, immutable Discord
snapshots beyond token expiry, nonce replay, stale canonical reservation
reclamation, V2 handle-only migration, and contradictory challenge outputs.

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

## Current verified deployment handoff

The latest operator deployment is independently verified from public Studionet
61999 data and matches the security-hardened source revision:

- Commit: `4b95cfdd3e806435666df3719e812de60348a686`
- Contract: `0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d`
- Deployment: [0x5614d0fc28aa4650e5aa2320dbd748cb7919446cd77c9180c1a1f08f9f54565a](https://explorer-studio.genlayer.com/tx/0x5614d0fc28aa4650e5aa2320dbd748cb7919446cd77c9180c1a1f08f9f54565a)
- Signer/admin: `0x4E44636494650386b89C64011c10f48D4b344c4f`
- Receipt: `FINALIZED`, `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, raw
  executions `SUCCESS`, `SUCCESS`.
- Source parity: exact after CRLF normalization; normalized SHA-256
  `4e4e54c8e60524f6fb0cf7ac9c7dbc5edb4ffdcae4019ad3ba7e7a9054b18c19`.
- Initial state: verifier `soulstamp-v3.0-continuity`, legacy contract
  `0x3108daffcbc24e261137056c56afcae17677bdfb`, and zero verifications,
  identities, challenges, and recoveries.
- Vercel: Production `dpl_3o8q26xjj76fr3ctyJhB1h4xxxn5` and Preview
  `dpl_JDM8fsgW57Ut77rJTstMauZbaJrv` are `READY`. The production alias is
  `https://soulstamp-gen.vercel.app`; the preview URL is
  `https://soulstamp-o5v36e0zx-delealufejoel-4184s-projects.vercel.app`.
  The protected deployment bundles and public alias bundle contain the new
  address and none of the checked superseded v3 addresses.
- Discord Worker: `GET /health` returned HTTP 200 with `ok: true`, and a fresh
  `get_stats()` read now confirms the new contract stores
  `https://soulstamp-discord.delealufejoel.workers.dev`. The operator supplied
  the external configuration, but no configuration transaction hash was
  supplied; this release record therefore confirms the live post-state without
  claiming independent finality metadata for that write.

This deployment-only evidence is recorded in
`artifacts/live/studionet-v3-release-2026-10-13.json` and
`artifacts/live/studionet-v3-external-proof-2026-10-13.json`. Lifecycle proof
remains `not_recorded`; no social verification, challenge, rebuttal, recovery,
revocation, eligibility, or negative-transition transaction is implied.

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

## Previous verified deployment handoff (superseded)

The latest operator deployment is independently verified from public Studionet
61999 data:

- Commit: `55dcdf15a665660f0a8de0da6c031796009325d1`
- Contract: `0xD16Da83DF7189475564B520bC22ec465c9a88621`
- Deployment: [0x330f956c29af8a7fea5b42f0058ef698f034ed33963a5e77b0f3c8e1aab32fde](https://explorer-studio.genlayer.com/tx/0x330f956c29af8a7fea5b42f0058ef698f034ed33963a5e77b0f3c8e1aab32fde)
- Signer: `0x4E44636494650386b89C64011c10f48D4b344c4f`
- Receipt: `FINALIZED`, `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, raw
  executions `SUCCESS`, `SUCCESS`.
- Source parity: exact after CRLF normalization; normalized SHA-256
  `c892d9afd3b7e6077ba2ee0c909dff3711b3baa175111bbc89bbac21030c71b0`.
- Initial state: verifier `soulstamp-v3.0-continuity`, admin
  `0x4e44636494650386b89c64011c10f48d4b344c4f`, legacy contract
  `0x3108daffcbc24e261137056c56afcae17677bdfb`, and zero verifications,
  identities, challenges, and recoveries.
- Vercel: Production `dpl_3E5bAFzgVW1EgjJrHhh16NUSGUC5` and Preview
  `dpl_4aixfrsNDPvExPsmxU846VavHPG7` are `READY`. The production alias is
  `https://soulstamp-gen.vercel.app`; the preview URL is
  `https://soulstamp-91idoe88o-delealufejoel-4184s-projects.vercel.app`.
  Both public bundles contain the new contract address and not the superseded
  V3 address.
- Discord Worker: `GET /health` returned HTTP 200 with `ok: true` and the
  expected stateless attestation storage. The new contract stores the Worker
  URL after finalized admin transaction
  [0x5362ebd8b941955cf5ce5cca6e01ae61a1a56be9e1f18498e727e24771308ee3](https://explorer-studio.genlayer.com/tx/0x5362ebd8b941955cf5ce5cca6e01ae61a1a56be9e1f18498e727e24771308ee3),
  which reached `FINALIZED / MAJORITY_AGREE / FINISHED_WITH_RETURN` with
  `SUCCESS`, `SUCCESS`.

This deployment-only evidence is recorded in
`artifacts/live/studionet-v3-release-2026-10-13.json`. Lifecycle proof remains
`not_recorded`; no social verification, challenge, rebuttal, recovery,
revocation, eligibility, or negative-transition transaction is implied.

## Previous verified deployment handoff (superseded)

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

## Confidence and reputation correction (previous deployment)

The engineering correction is source-parity verified on the new contract. Its normalized LF contract
SHA-256 is
`c892d9afd3b7e6077ba2ee0c909dff3711b3baa175111bbc89bbac21030c71b0`.
The correction
deterministically assigns active-proof confidence `92` (GitHub), `82` (X
handle-only), and `94` (Discord), keeps account/dossier values aligned, adds
immutable challenge evidence snapshots and safe stale reclamation, and does
not claim new live identity or lifecycle proofs. Vercel and the Discord
attestation base URL are now configured and verified; lifecycle proofs remain
operator-owned.

## Security and acceptance correction (deployed current)

Commit `4b95cfdd3e806435666df3719e812de60348a686` is deployed at
`0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d` with exact source parity. The
normalized LF SHA-256 of the current contract source is
`4e4e54c8e60524f6fb0cf7ac9c7dbc5edb4ffdcae4019ad3ba7e7a9054b18c19`.
The deployment reached `FINALIZED`, `MAJORITY_AGREE`, and
`FINISHED_WITH_RETURN` with successful leader executions. The new contract
started empty as recorded above; the Worker health check passed and a later
live `get_stats()` read confirms the externally configured Worker URL. The
configuration transaction hash was not supplied, so its receipt-level finality
metadata is not claimed here.

This pass keeps the single contract, frontend and Discord Worker architecture
and adds the following enforceable rules:

- Validators compare normalized decision material, not leader prose or volatile
  API metadata. Material includes provider/source facts, exact code presence,
  canonical ID, wallet, challenge/pending ID, issuer, nonce, attestation ID,
  issued/expiry/accepted timestamps, evidence hash and commitment. A leader
  cannot select a verdict and ask validators to repeat it.
- GitHub canonical IDs and Discord IDs can support a disputed handle
  reassignment only when fresh independent evidence proves a different
  canonical principal and the prior proof is stale, or the prior owner/admin
  explicitly released the handle. A still-fresh proof cannot be silently
  overwritten. The old canonical-ID reservation, wallet, reputation,
  unrelated links and audit history stay with the old identity; only the
  mutable platform-handle index changes. X has no immutable ID in oEmbed, so
  handle-only X evidence cannot reassign a reserved handle or authorize
  recovery.
- Persistent GitHub/X evidence must still contain the accepted exact code and
  the same normalized provider facts at resolution. A deleted, replaced or
  mismatching public document fails closed. Discord is different: its signed
  acceptance-time snapshot and commitment are independently checked after the
  five-minute attestation expires; the expired URL is not refetched.
- Challenger evidence starts the owner rebuttal deadline only after valid
  acceptance. A challenger-upheld decision has a 24-hour recovery delay and a
  full-24-hour owner-only counter-evidence window ending at the same boundary
  as recovery. The owner receives a new
  cancellation code; cancellation is independently verified, recorded in new
  immutable challenge fields and changes the challenge to
  `RECOVERY_CANCELLED`. Recovery remains one-use and account-scoped.

### What GenLayer is doing

Deterministic protocol logic establishes HTTPS/provider-origin rules, exact
code scans, normalized usernames, canonical IDs, wallet and challenge/pending
bindings, issuer/nonce/attestation checks, timestamp windows, evidence hashes,
commitments, status transitions, deadlines and confidence policy values.
GenLayer validator agreement is required for the independent web/snapshot
fact set and for a successful state-changing write. Genuine AI judgment is
limited to explanatory reasoning and selecting among the already-derived
`OWNER_UPHOLDS`, `CHALLENGER_UPHOLDS` or `INCONCLUSIVE` outcomes; it cannot
invent IDs, upgrade X evidence, change a reason code, or override a failed
fact check. Fetch failures, contradictory material and missing majority fail
closed.

### Frontend-led manual acceptance checklist

Every live write below must be reported only after `FINALIZED`,
`MAJORITY_AGREE`, successful GenVM execution and the expected post-state read:

1. On Studionet 61999, verify GitHub, X handle-only and Discord OAuth evidence.
   Confirm account/dossier confidence is `92/82/94`, X strength is `MEDIUM`,
   Discord nonce/attestation is consumed once, and `consumer_eligibility` is
   true.
2. Reverify each provider with fresh evidence. Confirm status, `is_active`,
   dossier score, wallet reputation and eligibility remain consistent. Delete
   or replace a GitHub/X code after challenge acceptance and confirm resolution
   does not authorize takeover.
3. Challenge a canonical GitHub or Discord link from a fresh wallet. Submit
   fresh challenger evidence and confirm the rebuttal deadline starts at its
   accepted timestamp. Test both no rebuttal and a valid owner rebuttal.
4. For Discord, resolve after the Worker token expires and confirm the
   accepted snapshot/commitment is used. For GitHub/X, confirm live code and
   normalized source facts remain present at resolution.
5. For a challenger-upheld result, confirm the 24-hour cooldown and that the
   owner counter deadline equals the recovery deadline. Publish the new owner
   counter code near the end of that period and call
   `cancel_wallet_recovery`; confirm `RECOVERY_CANCELLED`, restored eligibility,
   and that the challenger cannot replay recovery. In a separate fresh
   challenge, let the counter window lapse, wait for cooldown, execute recovery,
   and verify only the challenged link moves; unrelated links and source
   reputation do not.
6. Revoke a link and confirm mutable and canonical indexes behave as
   documented. Migrate a V2 handle-only record and confirm it is stale,
   discoverable and ineligible until owner-controlled reverification. Do not
   run V3-to-V3 migration.

This is an operator procedure, not live evidence. No new social, challenge,
rebuttal, recovery, revocation or migration receipt is claimed by this
repository change.
