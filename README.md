# SoulStamp

**SoulStamp v3 is a GenLayer-powered identity continuity, challenge, and wallet-recovery protocol.** It preserves the v1/v2 verification and proof-health product while adding enforceable canonical ownership, fresh-evidence challenges, bounded rebuttals, independent resolution, safety-delayed recovery, immutable history, and a consumer eligibility interface.

The v3 contribution is a lifecycle state machine, not a UI-only refresh: a consumer can call `is_eligible` or `consumer_eligibility`, while a challenger can submit fresh evidence, the current owner can rebut, and only an independently resolved challenger outcome can authorize recovery.

---

## Live Deployment

| Service | URL |
|---|---|
| Frontend | https://soulstamp-gen.vercel.app |
| Preview deployment | https://soulstamp-o5v36e0zx-delealufejoel-4184s-projects.vercel.app |
| Discord Worker | https://soulstamp-discord.delealufejoel.workers.dev |
| Repository | https://github.com/ometere123/soulstamp |

Current v3 Studionet deployment:

```text
Contract: 0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d
Deployment: https://explorer-studio.genlayer.com/tx/0x5614d0fc28aa4650e5aa2320dbd748cb7919446cd77c9180c1a1f08f9f54565a
Status: FINALIZED / MAJORITY_AGREE / FINISHED_WITH_RETURN / SUCCESS, SUCCESS
Deployment signer: 0x4E44636494650386b89C64011c10f48D4b344c4f
Deployed source: exact after CRLF normalization for commit 4b95cfd
Deployed source hash: 4e4e54c8e60524f6fb0cf7ac9c7dbc5edb4ffdcae4019ad3ba7e7a9054b18c19
Initial state: verifier `soulstamp-v3.0-continuity`, admin
`0x4e44636494650386b89c64011c10f48d4b344c4f`, legacy contract
`0x3108daffcbc24e261137056c56afcae17677bdfb`, and zero verifications,
identities, challenges, and recoveries.
Vercel: Production `dpl_3o8q26xjj76fr3ctyJhB1h4xxxn5` READY at
`https://soulstamp-gen.vercel.app`; Preview
`dpl_JDM8fsgW57Ut77rJTstMauZbaJrv` READY at
`https://soulstamp-o5v36e0zx-delealufejoel-4184s-projects.vercel.app`.
The production, preview, and public alias bundles contain the new contract
address and none of the checked superseded v3 addresses.
Lifecycle proof: not recorded; real identity verification, challenge,
rebuttal, recovery, revocation, and negative-transition testing remain operator-owned.
```

The existing Discord Worker is healthy at the existing URL (`GET /health`
returned HTTP 200 with `ok: true`, the expected public base URL, and
stateless-signed-attestation storage). The new contract's
`get_stats().discord_attestation_base_url` is currently empty, so Discord
verification on this fresh deployment is not yet enabled. The configured
admin must execute exactly one admin write:

```text
set_discord_attestation_base_url("https://soulstamp-discord.delealufejoel.workers.dev")
```

Transaction: [0x5362ebd8b941955cf5ce5cca6e01ae61a1a56be9e1f18498e727e24771308ee3](https://explorer-studio.genlayer.com/tx/0x5362ebd8b941955cf5ce5cca6e01ae61a1a56be9e1f18498e727e24771308ee3)
is for the superseded deployment and does not configure this contract. No
configuration transaction is claimed for the new address. From the repository
root, the admin can submit and then independently verify it with:

```powershell
$env:GENLAYER_PRIVATE_KEY = "<admin-only secret>"
node scripts/live_submit.mjs write 0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d set_discord_attestation_base_url '["https://soulstamp-discord.delealufejoel.workers.dev"]'
node scripts/finalized_tx.mjs <returned-tx-hash>
node scripts/live_read.mjs 0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d get_stats '[]'
```

Only a `FINALIZED` / `MAJORITY_AGREE` / `FINISHED_WITH_RETURN` receipt with
successful execution and a post-state URL equal to the Worker URL counts as
configured. The private key must never be committed or returned by the Worker.

The deployment and source-parity record is in
[artifacts/live/studionet-v3-release-2026-10-13.json](./artifacts/live/studionet-v3-release-2026-10-13.json).
Earlier deployment and Vercel/Worker history remains in the prior evidence
records and the superseded release sections below.

The normalized LF source SHA-256 for this deployed correction is
`c892d9afd3b7e6077ba2ee0c909dff3711b3baa175111bbc89bbac21030c71b0`.

---

## What Changed In v3

| Area | v3 improvement |
|---|---|
| X impersonation | Submitted status URLs are only locators; authorship is checked from the provider's HTTPS oEmbed `author_url` and exact handle. Current oEmbed is handle-only (`MEDIUM`) because it does not return an immutable author ID, so it cannot authorize wallet recovery. |
| Canonical ownership | Platform username and canonical platform ID are separate indexes. A fresh GitHub/Discord canonical-ID change can reassign only a handle whose prior proof is stale, or one explicitly released by its owner/admin; a still-fresh canonical owner cannot be silently overwritten. The old canonical binding, wallet, reputation, unrelated links and history remain with the old identity. X handle-only evidence cannot reassign a reserved handle. |
| Fresh evidence | Discord attestations are bound to wallet, code, pending/challenge ID, canonical Discord ID, configured issuer, expiry, attestation ID, nonce, and one-use on-chain token. |
| Challenges | Challenger evidence is accepted into an immutable hash/commitment snapshot. The challenger has a bounded submission deadline; the owner’s rebuttal window starts only after valid challenger evidence is accepted. |
| Resolution | GitHub/X evidence is independently revalidated at resolution and must still contain the accepted code plus the same normalized provider facts; expiring Discord attestations are resolved from their accepted snapshot without extending token lifetime. Validators compare all stable bindings, hashes and commitments—not prose or a preselected leader decision. |
| Recovery | A winning challenger alone can execute account-scoped recovery after a 24-hour safety delay. The current owner has a fresh counter-evidence cancellation window for that entire 24-hour cooldown, ending at the same boundary as recovery; unrelated links and reputation remain with the old principal and both principals retain append-only history. |
| Eligibility | `consumer_eligibility(address)` and `is_eligible(address)` require active identity state plus a fresh active proof. |
| Finality | Frontend writes and live proof tooling require `FINALIZED`, majority agreement, and `FINISHED_WITH_RETURN`; `ACCEPTED`, `Undetermined`, `NO_MAJORITY`, and `MAJORITY_DISAGREE` are never treated as success. |
| Continuity | `migrate_legacy_identity` explicitly imports v2 records, including handle-only historical X links, marks them stale, retains reservations, and writes a migration audit event. No V3-to-V3 migration is provided. |
| Confidence policy | Successful GitHub, X handle-only, and Discord evidence receives deterministic confidence `92`, `82`, and `94` respectively. LLM omissions, zeroes, and wording variance cannot override provider facts. |
| Assurance labels | The legacy on-chain `bot_score` field remains for v2 storage compatibility, but it is not a bot detector. The UI presents evidence assurance and protocol risk instead. |

See [V3_MILESTONE.md](./V3_MILESTONE.md) for the protocol state machine, migration plan, testing gates, and live-proof rules.

### Latest continuity correction — source parity verified live

Commit `4b95cfdd3e806435666df3719e812de60348a686` is deployed at the contract
address above with exact source parity. It keeps the X oEmbed compatibility and
genuine Worker-signed Discord URL handling from the preceding release, while
adding immutable challenge evidence snapshots, separate rebuttal deadlines,
safe stale reclamation and V2 handle-only migration. The security correction
also binds every decision-critical evidence field, supports canonical-ID-safe
username reassignment, requires live persistent-provider code at resolution,
and adds bounded owner counter-evidence cancellation before recovery. These
changes are covered by local executable tests; new live lifecycle proofs remain
operator-owned.

The latest security-pass contract source has normalized LF SHA-256
`4e4e54c8e60524f6fb0cf7ac9c7dbc5edb4ffdcae4019ad3ba7e7a9054b18c19`.
This is the exact normalized source hash independently matched to the deployed
contract source.

## What Changed In v2

| Area | v2 improvement |
|---|---|
| Contract hardening | Removed unsafe wall-clock-dependent verification logic and replaced verification codes with deterministic pending proof IDs/codes. |
| GenLayer verdicts | Verification now uses strict structured verdict fields instead of open-ended LLM text deciding state. |
| Proof Health | Every linked account has a health status: `ACTIVE`, `STALE`, `REVOKED`, `CONFLICTED`, or `FLAGGED`. |
| Reverification | Existing proofs can be rechecked against live public evidence without deleting the old proof. |
| Proof dossiers | Successful proofs store supporting evidence such as source URL, method, strength, risk band, confidence bucket, reason code, canonical ID, and wallet. |
| Source restrictions | GitHub, X/Twitter, and Discord proofs must come from expected source domains instead of arbitrary URLs. |
| Discord attestation | Discord verification uses an OAuth-backed Cloudflare Worker attestation with wallet binding, pending proof ID, verification code, Discord ID, expiry, issuer, and nonce. |
| Canonical IDs | GitHub numeric IDs and Discord user IDs are stored where available, with proof strength based on stable identity evidence. |
| Frontend | UI now highlights proof health, proof strength, risk band, dossiers, reverification, public lookup, audit timeline, and wallet persistence. |
| Backend | Discord OAuth moved to a stateless Cloudflare Worker that issues short-lived signed attestations for GenLayer to fetch. |

See [V2_MILESTONE.md](./V2_MILESTONE.md) for the milestone summary.

---

## Verification Flow

```text
1. request_verification(platform, username, profile_url)
       |
       +-> Creates a deterministic pending proof ID and public verification code.

2. User publishes the code publicly, or connects Discord through OAuth.

3. complete_verification(fetch_url)
       |
       +-> GenLayer fetches the allowed public source or fresh Discord attestation.
       +-> Validators produce strict structured JSON verdicts.
       +-> Critical fields are compared by consensus.
       +-> If valid, the account is stored with proof status ACTIVE, canonical ID, and a proof dossier.

4. reverify_platform(platform, username, fetch_url)
       |
       +-> GenLayer re-checks live proof evidence.
       +-> Proof health is updated to ACTIVE, STALE, CONFLICTED, REVOKED, or FLAGGED.
       +-> A new audit entry is recorded.

5. request_ownership_challenge(platform, username)
       |
       +-> A challenger submits fresh evidence before the challenger-evidence deadline.
       +-> Accepted evidence is snapshotted with an integrity commitment; for Discord, resolution never depends on a later refetch of the expired URL.
       +-> The current owner may submit a bounded rebuttal with fresh evidence.
       +-> Independent GenLayer resolution checks actual code, account, canonical-ID, and snapshot/live integrity facts and yields OWNER_UPHOLDS, CHALLENGER_UPHOLDS, or INCONCLUSIVE.
       +-> If no challenger evidence arrives, expire_ownership_challenge releases the slot after the challenger-evidence deadline.

6. execute_wallet_recovery(challenge_id)
       |
       +-> Only the winning challenger can execute after the safety delay.
       +-> Active principal history is copied to the new wallet; the old wallet is marked RECOVERED.

7. cancel_wallet_recovery(challenge_id, evidence_url)
       |
       +-> Before the 24-hour recovery cooldown closes, the current owner can publish a new counter code.
       +-> Fresh canonical evidence is independently checked and the cancellation is recorded as RECOVERY_CANCELLED.
```

---

## Structured GenLayer Verdict

GenLayer verification produces structured fields such as:

```json
{
  "code_found": true,
  "account_match": true,
  "platform": "github",
  "username": "example",
  "canonical_platform_id": "optional-id-if-available",
  "proof_strength": "strong",
  "risk_band": "low",
  "confidence_bucket": 92,
  "reason_code": "CODE_FOUND_ON_CANONICAL_PROFILE",
  "proof_status": "ACTIVE"
}
```

Critical provider facts are validated strictly. For an active proof, confidence is
recomputed from the provider/platform policy (`92` GitHub, `82` X handle-only,
`94` Discord); the LLM confidence field is explanatory input only. Risk and
strength are protocol classifications, and the legacy `bot_score` storage field
must not be read as bot detection.

---

## Supported Platforms

- **GitHub**: code detected from the expected GitHub public source, with numeric GitHub ID stored when available.
- **X / Twitter**: code detected from the expected X/Twitter public source.
- **Discord**: OAuth-backed trusted attestation fetched by GenLayer from the configured Cloudflare Worker.

Discord is not presented as fully trustless cryptographic identity. It is an OAuth-backed attestation that GenLayer validators independently fetch and evaluate.

---

## Project Structure

```text
SoulStamp/
├── contracts/
│   └── soul_stamp.py
├── backend/
│   ├── index.js
│   ├── package.json
│   └── wrangler.toml
├── frontend/
│   └── src/
├── tests/
│   ├── direct/test_soul_stamp_protocol.py
│   ├── integration/test_studionet_smoke.py
│   ├── frontend/finality.test.ts
│   ├── worker/worker.test.mjs
│   └── test_soul_stamp.py
├── scripts/
│   ├── contract_gates.py
│   ├── live_read.mjs
│   └── live_studionet_proof.py
├── README.md
└── V2_MILESTONE.md
```

---

## Local Setup

### Contract and gates

```bash
npm ci
python -m pip install -r requirements-dev.txt
python scripts/contract_gates.py
python -m pytest tests/direct tests/test_soul_stamp.py -q
npm run test:all
npm --prefix frontend run build
npm --prefix backend run check
```

The semantic gate selects the repository-compatible cached GenVM runner with
`GENVM_VERSION=v0.2.16`. The contract header pins the exact py-genlayer
runner dependency; do not remove either pin without rerunning semantic validation.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
npm run build
```

### Discord Worker

```bash
cd backend
npm install
npm run check
npm run deploy
```

Required Worker variables/secrets:

```text
PUBLIC_BASE_URL=https://soulstamp-discord.your-subdomain.workers.dev
FRONTEND_ORIGIN=https://your-frontend.vercel.app
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_REDIRECT_URI=https://soulstamp-discord.your-subdomain.workers.dev/api/discord/callback
BACKEND_SESSION_SECRET=stored as Cloudflare secret
DISCORD_CLIENT_SECRET=stored as Cloudflare secret
```

The same callback URL must be registered in the Discord Developer Portal.

---

## Contract API Overview

### Write Methods

| Method | Purpose |
|---|---|
| `request_verification` | Start a platform proof and create deterministic pending proof data. |
| `complete_verification` | Use GenLayer consensus to validate a public proof or Discord attestation. |
| `reverify_platform` | Re-check an already linked proof and update health. |
| `cancel_pending_verification` | Cancel the current pending proof. |
| `revoke_platform` | Revoke an existing linked proof. |
| `flag_identity` / `unflag_identity` | Admin moderation for risky or abusive identities. |
| `set_discord_attestation_base_url` | Admin config for the trusted Discord Worker base URL. |
| `transfer_admin` | Transfer admin role. |
| `request_ownership_challenge` | Open a fresh-evidence ownership challenge. |
| `submit_challenge_evidence` | Submit challenger evidence before the deadline. |
| `respond_to_challenge` | Submit the current owner’s bounded rebuttal. |
| `resolve_ownership_challenge` | Run independent GenLayer challenge resolution. |
| `expire_ownership_challenge` | Expire an unanswered challenge after its evidence deadline and release the slot. |
| `execute_wallet_recovery` | Execute safety-delayed principal recovery for the winning challenger. |
| `migrate_legacy_identity` | Admin-controlled, explicit v2 continuity migration. |

### View Methods

| Method | Purpose |
|---|---|
| `get_identity` | Read a wallet identity, linked accounts, dossiers, and health data. |
| `get_pending_verification` | Read the active pending proof for a wallet. |
| `lookup_by_platform` | Find which wallet owns a platform account. |
| `get_audit_log` | Read proof and moderation history. |
| `get_all_addresses` | Paginated wallet registry. |
| `get_stats` | Platform statistics and configuration. |
| `get_challenges` / `get_all_challenges` | Challenge status, evidence references, deadlines, and outcomes. |
| `consumer_eligibility` / `is_eligible` | Enforceable consumer-facing eligibility decision. |

---

## Security Notes

- Verification codes are public, deterministic proof markers, not secrets.
- Proof decisions remain in the GenLayer contract flow; the backend does not become the final verifier.
- Fetch URLs are restricted to expected sources for each platform.
- Discord attestations are short-lived and bound to wallet, proof code, pending/challenge ID, Discord ID, configured issuer, nonce, attestation ID, and accepted-time integrity. A challenge snapshot does not extend the attestation’s lifetime.
- Removed unsafe contract dependence on local wall-clock timestamps for proof creation and strict expiry behavior.
- GenLayer consensus stores structured evidence, resolves contested ownership, and maintains proof health over time. Expired canonical proofs retain their reservation until a fresh-evidence challenge and bounded owner-response process authorizes reclamation; handle-only X and legacy records cannot authorize recovery.

## Studionet release proof

Deployment is intentionally separate from CI. After all local gates pass, use
the repository-local CLI and configured keystore:

```bash
$env:SOULSTAMP_ADMIN_ADDRESS="0x..."
# Optional in CI or another non-interactive runner; keep this masked.
$env:GENLAYER_PRIVATE_KEY="0x..."
python scripts/live_studionet_proof.py
```

For local use, the same two names may be kept in the ignored repository-root
`.env` instead; the release script reads only those names and never prints
them. Existing process environment values take precedence. Do not commit that
file or place signing keys in frontend or Worker configuration.

The admin address must be the public address corresponding to the signer. With
no `GENLAYER_PRIVATE_KEY`, the script uses the CLI 0.39.1 OS-keychain account;
with the masked variable, it signs through the repository-local SDK without
putting the key in command-line arguments. Neither path prints or stores the
key.

The script fails closed unless deployment reaches FINALIZED with
`MAJORITY_AGREE` and `FINISHED_WITH_RETURN` and the RPC-returned contract source matches the local
source after line-ending normalization. It records both normalized source
hashes and the normalization rule, never prints or stores signing keys, and a
successful run writes transaction hashes, execution outcomes, contract
address, source hash, and explorer link to
`artifacts/live/studionet-v3-proof.json`.
The artifact includes a finalized failed recovery transition as a negative
guard proof; additional positive lifecycle steps are supplied explicitly with
`SOULSTAMP_LIVE_LIFECYCLE_JSON`. Every successful step must include a `verify`
object such as `{"method":"get_challenge","args":["CHALLENGE_ID"],"assertions":[{"path":"status","value":"RESOLVED_CHALLENGER"}]}`;
the runner reads that view after finality and records the checked state. A
successful receipt without a matching state assertion is rejected.
Each lifecycle item may set `"signer":"deployer"` (default) or
`"signer":"admin"`; the latter uses the separate local/Actions secret
`SOULSTAMP_ADMIN_PRIVATE_KEY`, while `SOULSTAMP_ADMIN_ADDRESS` remains the
public constructor admin address. This permits a real two-wallet challenge
and recovery proof without putting either key in the frontend or Worker.

The live runner requires full lifecycle evidence by default; the opt-in GitHub
job makes this explicit with `SOULSTAMP_REQUIRE_FULL_LIFECYCLE=1` and also
requires the masked secret `SOULSTAMP_LIVE_LIFECYCLE_JSON`. That plan must
contain successful, post-state-asserted steps for verification, challenge
evidence, owner rebuttal, independent resolution, wallet recovery, and
revocation. The runner rejects a missing step before deployment and records
negative steps separately. The operator must prepare real public evidence for
the generated codes; a plan containing fabricated URLs or assertions is not a
live proof. Setting `SOULSTAMP_REQUIRE_FULL_LIFECYCLE=0` is reserved for an
explicit partial deployment probe and does not satisfy the milestone.

The GitHub Actions live job is intentionally opt-in. Configure the repository
secret `GENLAYER_PRIVATE_KEY` and public Actions variable
`SOULSTAMP_ADMIN_ADDRESS`, the admin signer secret
`SOULSTAMP_ADMIN_PRIVATE_KEY`, and the full lifecycle plan secret
`SOULSTAMP_LIVE_LIFECYCLE_JSON`, then manually run **SoulStamp CI** with
`run_live=true`. A normal push runs all gates but never deploys.

### Operator-deployed external proof

The operator may deploy and exercise the contract outside this workspace. This
is a supported read-only handoff path and does not require sending either
private key. Deploy the exact CI-tested revision with the repository-local CLI
on Studionet only, then provide the public contract address, deployment
transaction hash, and a JSON plan containing the finalized transaction hash for
each lifecycle step. The plan must contain successful, post-state-asserted
steps for all required methods and may contain expected-failure steps as well.

If lifecycle transactions are not available yet, record deployment evidence
without overstating completion:

```powershell
python scripts/verify_external_studionet_proof.py `
  --contract 0x... `
  --deployment-tx 0x... `
  --deployment-only `
  --artifact .\artifacts\live\studionet-v3-deployment-proof.json
```

This deployment-only mode verifies finality, successful execution, source
parity, and v3 state, and explicitly records lifecycle proof as
`not_recorded`. It never substitutes for the full lifecycle plan below.

Example plan shape (replace every hash and state value with real observations):

```json
[
  {"method":"request_verification","tx":"0x...","expect_sender":"0x...","args":["github","user","https://github.com/user"],"verify":{"method":"get_pending_verification","args":["0x..."],"assertions":[{"path":"found","value":true}]}},
  {"method":"complete_verification","tx":"0x...","expect_sender":"0x...","args":["https://github.com/user"],"verify":{"method":"get_identity","args":["0x..."],"assertions":[{"path":"found","value":true}]}},
  {"method":"request_ownership_challenge","tx":"0x...","expect_sender":"0x...","args":["github","user"],"verify":{"method":"get_challenge","args":["CHALLENGE_ID"],"assertions":[{"path":"status","value":"OPEN"}]}},
  {"method":"submit_challenge_evidence","tx":"0x...","expect_sender":"0x...","args":["CHALLENGE_ID","https://github.com/user"],"verify":{"method":"get_challenge","args":["CHALLENGE_ID"],"assertions":[{"path":"status","value":"AWAITING_REBUTTAL"},{"path":"challenger_evidence_status","value":"ACTIVE"}]}},
  {"method":"respond_to_challenge","tx":"0x...","expect_sender":"0x...","args":["CHALLENGE_ID","https://github.com/user","statement"],"verify":{"method":"get_challenge","args":["CHALLENGE_ID"],"assertions":[{"path":"status","value":"RESPONDED"},{"path":"owner_evidence_status","value":"ACTIVE"}]}},
  {"method":"resolve_ownership_challenge","tx":"0x...","expect_sender":"0x...","args":["CHALLENGE_ID"],"verify":{"method":"get_challenge","args":["CHALLENGE_ID"],"assertions":[{"path":"status","value":"RESOLVED_CHALLENGER"}]}},
  {"method":"execute_wallet_recovery","tx":"0x...","expect_sender":"0x...","args":["CHALLENGE_ID"],"verify":{"method":"get_challenge","args":["CHALLENGE_ID"],"assertions":[{"path":"status","value":"EXECUTED"}]}},
  {"method":"revoke_platform","tx":"0x...","expect_sender":"0x...","args":["github"],"verify":{"method":"get_identity","args":["0x..."],"assertions":[{"path":"eligible","value":false}]}}
]
```

`CHALLENGE_ID` is the deterministic ID returned by the finalized
`request_ownership_challenge` state read. The challenge state names above are
the contract’s actual enum values; there is no `EVIDENCE_PENDING`,
`evidence_submitted`, or `rebuttal_submitted` field. For the recovery step,
use the winning challenger wallet in the `get_identity` arguments if you also
want to assert the new principal’s `identity_state` and `eligible` result.

Run the public verifier after saving that plan:

```powershell
python scripts/verify_external_studionet_proof.py `
  --contract 0x... `
  --deployment-tx 0x... `
  --deployment-sender 0x... `
  --plan-file .\external-lifecycle.json
```

It checks Studionet chain 61999, FINALIZED status, successful execution as
`FINISHED_WITH_RETURN`, expected failed execution for negative steps, exact
deployed-source parity after line-ending normalization, the v3 verifier
version, and each supplied post-state assertion. It writes only public evidence to
`artifacts/live/studionet-v3-external-proof.json`. A contract address by itself
is not a lifecycle proof; include the deployment and lifecycle transaction
hashes plus the generated challenge IDs and observed state values.

The finality inspector also requires the consensus result `MAJORITY_AGREE` and
records the public signer, decoded method, and exact arguments for every
transaction. A receipt that is `FINALIZED` with leader execution `SUCCESS` but
consensus `Undetermined`, `NO_MAJORITY`, or `MAJORITY_DISAGREE` is rejected.

