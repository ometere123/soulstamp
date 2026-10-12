# SoulStamp

**SoulStamp v3 is a GenLayer-powered identity continuity, challenge, and wallet-recovery protocol.** It preserves the v1/v2 verification and proof-health product while adding enforceable canonical ownership, fresh-evidence challenges, bounded rebuttals, independent resolution, safety-delayed recovery, immutable history, and a consumer eligibility interface.

The v3 contribution is a lifecycle state machine, not a UI-only refresh: a consumer can call `is_eligible` or `consumer_eligibility`, while a challenger can submit fresh evidence, the current owner can rebut, and only an independently resolved challenger outcome can authorize recovery.

---

## Live Deployment

| Service | URL |
|---|---|
| Frontend | https://soulstamp-gen.vercel.app |
| Discord Worker | https://soulstamp-discord.delealufejoel.workers.dev |
| Repository | https://github.com/ometere123/soulstamp |

Current v3 Studionet deployment:

```text
Pending release gate. Do not point the frontend at a contract until
scripts/live_studionet_proof.py records FINALIZED + FINISHED_WITH_RETURN and
exact source parity in artifacts/live/studionet-v3-proof.json.
```

---

## What Changed In v3

| Area | v3 improvement |
|---|---|
| X impersonation | Submitted status URLs are only locators; authorship is checked from the oEmbed `author_url` and canonical author ID. |
| Canonical ownership | Platform username and canonical platform ID are separate indexes and both are reserved/released atomically. |
| Fresh evidence | Discord attestations are bound to wallet, code, pending/challenge ID, issuer, expiry, and a one-use on-chain token. |
| Challenges | Challengers receive a fresh code and bounded rebuttal window; both evidence paths are independently resolved through GenLayer. |
| Recovery | A winning challenger alone can execute recovery after a safety delay; old and new wallets retain append-only history. |
| Eligibility | `consumer_eligibility(address)` and `is_eligible(address)` require active identity state plus a fresh active proof. |
| Finality | Frontend writes and live proof tooling require `FINALIZED` and `FINISHED_WITH_RETURN`; ACCEPTED is never treated as success. |
| Continuity | `migrate_legacy_identity` explicitly imports v2 records, retains the legacy address, and writes a migration audit event. |

See [V3_MILESTONE.md](./V3_MILESTONE.md) for the protocol state machine, migration plan, testing gates, and live-proof rules.

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
       +-> A challenger submits fresh evidence before the rebuttal deadline.
       +-> The current owner may submit a bounded rebuttal with fresh evidence.
       +-> Independent GenLayer resolution yields OWNER_UPHOLDS, CHALLENGER_UPHOLDS, or INCONCLUSIVE.

6. execute_wallet_recovery(challenge_id)
       |
       +-> Only the winning challenger can execute after the safety delay.
       +-> Active principal history is copied to the new wallet; the old wallet is marked RECOVERED.
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
  "confidence_bucket": 90,
  "reason_code": "CODE_FOUND_ON_CANONICAL_PROFILE",
  "proof_status": "ACTIVE"
}
```

Critical fields are validated strictly. Confidence uses bounded tolerance, and risk/proof values must be from allowed sets.

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
- Discord attestations are short-lived and bound to wallet, proof code, pending proof ID, Discord ID, issuer, and nonce.
- Removed unsafe contract dependence on local wall-clock timestamps for proof creation and strict expiry behavior.
- GenLayer consensus stores structured evidence, resolves contested ownership, and maintains proof health over time.

## Studionet release proof

Deployment is intentionally separate from CI. After all local gates pass, use
the repository-local CLI and configured keystore:

```bash
$env:SOULSTAMP_ADMIN_ADDRESS="0x..."
# Optional in CI or another non-interactive runner; keep this masked.
$env:GENLAYER_PRIVATE_KEY="0x..."
python scripts/live_studionet_proof.py
```

The admin address must be the public address corresponding to the signer. With
no `GENLAYER_PRIVATE_KEY`, the script uses the CLI 0.39.1 OS-keychain account;
with the masked variable, it signs through the repository-local SDK without
putting the key in command-line arguments. Neither path prints or stores the
key.

The script fails closed unless deployment reaches FINALIZED with
`FINISHED_WITH_RETURN` and the RPC-returned contract source equals the local
source byte-for-byte. It never prints or stores signing keys. A successful run
writes transaction hashes, execution outcomes, contract address, source hash,
and explorer link to `artifacts/live/studionet-v3-proof.json`.
The artifact includes a finalized failed recovery transition as a negative
guard proof; additional positive lifecycle steps are supplied explicitly with
`SOULSTAMP_LIVE_LIFECYCLE_JSON`. Every successful step must include a `verify`
object such as `{"method":"get_challenge","args":["CHALLENGE_ID"],"assertions":[{"path":"status","value":"RESOLVED_CHALLENGER"}]}`;
the runner reads that view after finality and records the checked state. A
successful receipt without a matching state assertion is rejected.

The GitHub Actions live job is intentionally opt-in. Configure the repository
secret `GENLAYER_PRIVATE_KEY` and public Actions variable
`SOULSTAMP_ADMIN_ADDRESS`, then manually run **SoulStamp CI** with
`run_live=true`. A normal push runs all gates but never deploys.

