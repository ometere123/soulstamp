# SoulStamp V4 — TrustPass & Sybil Gate

V4 extends the accepted V3 identity-continuity authority. V3 remains the sole
authority for GitHub, X, Discord, canonical ownership, challenges, recovery,
proof health and identity eligibility. V4 reads V3 and never writes V3 state,
transfers a V3 identity, or treats a payment as a PASS.

## Product boundary

V4 provides policy-bound, expiring assessments with three outcomes:
`PASS`, `FAIL`, and `INCONCLUSIVE`. A genuine adverse fact is a completed
`FAIL`; conflicting evidence is a completed `INCONCLUSIVE`; unavailable
infrastructure, unsettled payment, invalid consent, and failed execution are
not completed assessments. A settled `PASS` is consumable only after the
corresponding Arc settlement event has been independently consumed by V4.

The Identity TrustPass uses current V3 eligibility and selected credentials.
The Sybil-resistant TrustPass additionally reads Human Passport evidence for
the exact subject wallet. Neither tier claims that social accounts prove one
human or prevents all multi-wallet participation.

## Current V4.2 unified-Passport release

The deployed V4.2 contract source is from commit
`ae494fe5045b20a00babea3838c26e8989ab5e03`. Its LF-normalized source hash is:

`c49fe8d5eb0f7f9771fb0a6c47c218c74c79d48e2aded5c664f1f573e556d5f4`

The current deployment is:

| Network | Component | Address | Evidence |
|---|---|---|---|
| GenLayer Studionet `61999` | V4.2 TrustPass | `0xFdb126147cE5DFD9Cb461079d77cae5803E7E7F2` | [deployment receipt](https://explorer-studio.genlayer.com/tx/0xa3475265f2f0cef9c3fdcb7c49d81f9c3d04eb90257da31b5a56a29f0df6ff0d) |
| Arc Testnet `5042002` | V4.2 USDC escrow | `0x686f8ab8ce08512af72ab26c78a98a23ea8b71be` | [deployment](https://explorer.testnet.arc.io/tx/0xc2bd928fe9010d34a87b3a3ac6f565dbca5c17604ff30024f9a3d59ab2b1af8f), [V4 binding](https://explorer.testnet.arc.io/tx/0x98d2ef4169085e695aa8cfabaedc365bb12b0ea7fd0e2878995e1076dc75a80f) |
| GenLayer V3 preserved | Identity authority | `0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d` | unchanged |

The GenLayer deployment was independently rechecked after deployment:
`FINALIZED`, `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, raw execution
`SUCCESS/SUCCESS`, signer/admin `0x231EF01E282385eC2E22394469f1C8c6C28Fd6b1`,
and exact remote/local source parity after LF normalization. The constructor
state links V3, the new escrow, the Worker URL and the configured Human
Passport decoder; all policy/request/assessment/pass/settlement/refund
counters were zero at verification.

The Arc escrow was independently read on chain `5042002`: USDC is
`0x3600000000000000000000000000000000000000`, price is exactly `1000000`
(1 USDC at six ERC-20 decimals), the new V4 address is bound once, all three
roles are the deployer/admin address, liabilities and earned revenue are zero,
and the escrow is solvent.

## Corrections in this release

- V3 `verified_at` is treated as an opaque historical marker. V4 freshness now
  uses the actual V3 dossier issue/expiry fields and current proof status; it
  no longer subtracts an event counter from Unix time.
- Consumer eligibility revalidates every required social credential, including
  status, strength, dossier expiry and available freshness. Revoking one
  required credential invalidates the TrustPass even if another remains active.
- Google ID-token validation accepts the genuine approximately one-hour token
  lifetime while retaining issuer, audience, signature, nonce, `iat`, `exp`
  and `email_verified` checks.
- Consent expiry is bound into the payment intent and remains valid for an
  on-time deposit; stale consent cannot authorize a new sponsored request.
- The frontend reads the actual Arc payment record and deposit event, resumes
  an interrupted escrow without a second payment, identifies the original
  payer, exposes the 72-hour refund time, and reports refund success only after
  Arc and GenLayer both confirm their expected state changes.
- Frontend fallback addresses now point at the current V4/Arc pair, so a
  missing public environment variable cannot silently select a superseded
  deployment.

## Components and trust boundaries

| Component | Responsibility |
|---|---|
| `contracts/soul_stamp.py` | Preserved V3 identity authority. |
| `contracts/soulstamp_trustpass.py` | V4 policies, requests, consent, evidence, assessment, eligibility and settlement consumption. |
| `evm/SoulStampPaymentEscrow.sol` | Arc Testnet USDC request-bound escrow, one-way settlement, timeout refund and accounting. |
| `backend/index.js` | Existing Discord Worker plus isolated Google OIDC authorization-code/PKCE and signed attestations. |
| `frontend/src/components/*TrustPass*` | Wallet, consent, Google, Human Passport, Arc payment/recovery and organization flows. |

The Worker is an authenticated issuer for Google and Discord attestations. The
contract stores a keyed commitment and public evidence references, not raw
Google email, `sub`, OAuth tokens or client secrets. GenLayer validator
agreement verifies consistent retrieval and decision-critical fields; it does
not turn a Worker or RPC provider into a cryptographic bridge.

The Arc settlement operator is an explicit cross-chain trust assumption. It
must verify a finalized successful GenLayer result and submit the unique,
request-bound Arc settlement acknowledgement. V4 then independently consumes
the real settlement event. If settlement is not acknowledged before the
72-hour escrow deadline, the original payer can recover funds; the assessment
does not become usable merely because payment occurred.

## Google live status

The existing Worker remains at
<https://soulstamp-discord.delealufejoel.workers.dev>. Its live `/health`
response was checked after deployment and reported `discord_configured: true`,
`google_configured: true`, and the exact callback
`/api/google/callback`. This proves configuration and health only. No
user-controlled Google sign-in, Google account link transaction, or duplicate
account test is claimed in the ledger yet.

The required callback is:

`https://soulstamp-discord.delealufejoel.workers.dev/api/google/callback`

The real flow remains server-side OIDC with state, PKCE, nonce, issuer,
audience, JWKS signature, time and verified-email checks. A consenting user
must complete the browser login and wallet-bound link action before Google is
marked live evidence.

## OAuth configuration audit — 2026-10-19

Production and Preview Vercel variables were independently pulled from the
existing `soulstamp` project and both point `VITE_GOOGLE_WORKER_URL` and
`VITE_DISCORD_BACKEND_URL` at the current Cloudflare Worker. The Worker
returned HTTP 200 from `/health` with Discord and Google configured. Its
read-only OAuth start routes emit the exact Discord callback
`/api/discord/callback` and Google callback `/api/google/callback` on that
Worker.

The legacy Google Cloud Function returned HTTP 404 for its health, Discord
start, Google start, and callback routes. It is therefore recorded as an
inactive legacy backend, not replaced by assumption. No Discord provider
credentials were changed. The current Worker’s latest live version after
secret-record cleanup is `7a4d5975-57bd-4c7d-8ee0-426f326d5b45`.

The frontend callback correction is in commit `c49b4c1`. A Google success is
captured before the URL is scrubbed, routes to TrustPass, restores only the
matching `google_pending_id`, waits for the bound wallet, and exposes
**Complete Google linking**. It only reports Linked after a finalized V4 write
and a post-state read containing the Google commitment. Discord’s existing
Verify Identity callback path remains unchanged.

## Human Passport live audit

V4 uses Optimism Sepolia chain `11155420`, decoder
`0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56`, and selector `0xd47875d0`.
The documented raw score scale is four decimals; raw `200000` is score 20.

At block `50307497`, hash
`0x33d845abf8cf74181cd38fd5d0c56f0533386c95a9f047f02dbd03070386c5ab`, the
decoder bytecode was present and the RPC chain was `11155420`. The exact
`getScore(address)` call reverted with `0x120a2e77` for the deployer, the
three local test wallets and the two currently known V3 wallet addresses.
Therefore the reported score of approximately 44 is not independently
confirmed by V4. The user’s Passport subject wallet is not present in the
repository configuration, so no wallet from the checks above is substituted
for it. The Ethereum Sepolia mint is not evidence for the configured
Optimism-Sepolia decoder.

## Vercel release

The existing project was redeployed after setting only the public V4 and Arc
addresses. V3 and Worker configuration were preserved.

| Environment | Deployment | Status | Bundle verification |
|---|---|---|---|
| Production | [`dpl_H2r1eNtf1g6i4CSf8qXxQzbTQtsU`](https://vercel.com/delealufejoel-4184s-projects/soulstamp/H2r1eNtf1g6i4CSf8qXxQzbTQtsU) | READY; [soulstamp-gen.vercel.app](https://soulstamp-gen.vercel.app) | served `index-DK4lfddf.js` contains current V4, current Arc escrow, Worker URL and callback code; legacy Cloud Function URL absent |
| Preview | [`dpl_5HGg2qznpThXrjSVGFNyor4xvPxn`](https://vercel.com/delealufejoel-4184s-projects/soulstamp/5HGg2qznpThXrjSVGFNyor4xvPxn) | READY; [preview](https://soulstamp-j0iuon5oa-delealufejoel-4184s-projects.vercel.app) | same authenticated bundle checks |

## Live lifecycle evidence

The current V4 contract starts with zero policies, requests, assessments,
passes, settlements and refunds. No deposit, consent, assessment, settlement,
refund, Google link or positive Human Passport transaction is invented here.
The following scenarios remain `UNTESTED` or `BLOCKED_EXTERNAL_ACTION`:

- real Google OAuth and wallet-bound `link_google_attestation`;
- the user’s public Passport wallet, authenticated decoder score and
  `refresh_humanity_evidence` transaction;
- a real V3-verified subject signature, consent and 1 USDC Arc deposit;
- PASS, FAIL and INCONCLUSIVE assessment receipts and post-state;
- operator settlement and GenLayer settlement consumption;
- duplicate-payment rejection, stale/invalid consent, interrupted-payment
  resume and full 72-hour refund.

Local Direct Mode, Worker, frontend and Foundry tests cover these positive,
negative and adversarial branches with fixtures. They are not substitutes for
the missing live transactions.

## Historical deployments

The previous engineering pair remains recorded and is not attributed to the
current release:

- V4 `0xcdec5d1bE08456dF05BBCe4c0A34A6AB5c71dCF2`, deployment
  `0xb16bbf2cc1bed529577c3232cd48c260da7c5065b6fd7524b868f721288c0b05`.
- Arc escrow `0x847269d045a0e0c6fad1fedb155d3a1dfc6936df`, deployment
  `0x86ba6ad19cb591cf8d876207bbb138dace8f9b713ef0e02f80db85becab9b819`,
  binding `0xd0dafa54ce01a6af3a25c87ad2cbdd3e5058494167ccbb37f65c314a18dd9242`.

The complete structured ledger is
[`artifacts/live/v4-deployment.json`](./artifacts/live/v4-deployment.json),
and the read-only current-contract audit is
[`artifacts/live/v4-lifecycle-audit.json`](./artifacts/live/v4-lifecycle-audit.json).

## Unified Human Passport compatibility correction

The current subject evidence is now independently confirmed as a unified EAS
attestation on Optimism Sepolia, not an invalid Passport record. The exact
recipient wallet is `0xFd69A5D0b8330dC86e266304B3D1ABE3F57b9D09`; the attestation
UID is
`0x65843ca97b6f8133713feeff548173b64cb5c7bf98839e68f77c701fb6d17813`; the
schema UID is
`0x81d8758ccd97bbeea7642df29001f6046a676b3c24f808c4297db5ee36838dd8`; scorer
`335` returned raw `446980` with four decimals, so the authenticated display is
`44.6980` and the raw `200000` threshold is met. The attestation expires at
`2027-01-17T13:05:57Z` and was not revoked at the pinned read.

The historical V4.1 decoder remains legacy-schema-only and returns
`0x120a2e77` (`AttestationNotFound`) for this unified UID. The deployed V4.2
source adds strict EAS `getAttestation` and Schema Registry reads at a pinned
block, exact schema/resolver/attester/recipient/scorer checks, dynamic ABI
decoding, evidence commitments, and independent validator re-reads. Its exact
LF-normalized source hash is
`c49fe8d5eb0f7f9771fb0a6c47c218c74c79d48e2aded5c664f1f573e556d5f4`, matching
the deployed source. The old V4.1 escrow and its historical funded request
remain separate; neither payment nor state is silently migrated into V4.2.
The legacy `getScore(uint256,address)` form was also attempted with scorer
`335` and returned the same `AttestationNotFound` revert.

The existing funded request is preserved without assessment or settlement.
Arc escrow reports `ESCROWED`, amount `1000000`, and `depositedAt`
`2026-10-19T23:03:49Z`. The authoritative refund deadline is
`2026-10-22T23:03:49Z`. The original payer can use the existing escrow’s
permissionless `refund(requestKey)` after that time; the funds always return to
the stored payer. Only after a successful Arc receipt and `status=REFUNDED`
should `confirm_arc_refund` be submitted on the current V4. The complete
procedure and no-write status are recorded in
[`artifacts/live/v4-unified-passport-readiness.json`](./artifacts/live/v4-unified-passport-readiness.json).

The old escrow is bound to the old V4, so the unified path uses the fresh V4.2
pair after the old request is recovered. The old payment cannot be migrated or
reused, and V3 remains unchanged.

## Engineering gates

```text
python scripts/contract_gates.py
python -m pytest tests -q
npm run test:frontend
npm run test:finality
npm --prefix backend test
forge fmt --check && forge build && forge test
npm --prefix frontend run build
npm audit --omit=dev --audit-level=high
npm audit --prefix frontend --omit=dev --audit-level=high
npm audit --prefix backend --omit=dev --audit-level=high
npm audit --audit-level=high  # advisory report for pinned development tooling
```

The repository-local GenLayer CLI is pinned to `0.39.1`; GenVM semantic
validation uses the repository’s pinned runner/linter configuration. Foundry
uses Solidity `0.8.24`. Dependency audit findings, if present, remain
reported separately from functional gate results. The current runtime audits
are clean; the full development-tool audit still reports six advisories in the
pinned GenLayer/Vitest toolchain and remains non-blocking for deployed runtime
code because upgrading it would change the required CLI toolchain.
