# SoulStamp

**SoulStamp v2 is a GenLayer-powered identity proof health protocol.** It links wallets to public GitHub, X/Twitter, and Discord identities, then uses GenLayer consensus to verify and re-check whether each public proof remains healthy over time.

The main v2 upgrade is not storage. It is **Proof Health + Reverification**: GenLayer acts as an ongoing identity proof judge and marks linked accounts as `ACTIVE`, `STALE`, `REVOKED`, `CONFLICTED`, or `FLAGGED` based on live public evidence and structured validator agreement.

---

## Live Deployment

| Service | URL |
|---|---|
| Frontend | https://soulstamp-gen.vercel.app |
| Discord Worker | https://soulstamp-discord.delealufejoel.workers.dev |
| Repository | https://github.com/ometere123/soulstamp |

Current Studionet contract address used by the frontend:

```text
0x3108dafFCBC24E261137056c56aFCAE17677BDfB
```

---

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
       +-> GenLayer fetches the allowed public source or Discord attestation.
       +-> Validators produce strict structured JSON verdicts.
       +-> Critical fields are compared by consensus.
       +-> If valid, the account is stored with proof status ACTIVE and a proof dossier.

4. reverify_platform(platform, username, fetch_url)
       |
       +-> GenLayer re-checks live proof evidence.
       +-> Proof health is updated to ACTIVE, STALE, CONFLICTED, REVOKED, or FLAGGED.
       +-> A new audit entry is recorded.
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
│   └── test_soul_stamp.py
├── README.md
└── V2_MILESTONE.md
```

---

## Local Setup

### Contract

```bash
genlayer up
genlayer deploy contracts/soul_stamp.py
genlayer test tests/
```

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

### View Methods

| Method | Purpose |
|---|---|
| `get_identity` | Read a wallet identity, linked accounts, dossiers, and health data. |
| `get_pending_verification` | Read the active pending proof for a wallet. |
| `lookup_by_platform` | Find which wallet owns a platform account. |
| `get_audit_log` | Read proof and moderation history. |
| `get_all_addresses` | Paginated wallet registry. |
| `get_stats` | Platform statistics and configuration. |

---

## Security Notes

- Verification codes are public, deterministic proof markers, not secrets.
- Proof decisions remain in the GenLayer contract flow; the backend does not become the final verifier.
- Fetch URLs are restricted to expected sources for each platform.
- Discord attestations are short-lived and bound to wallet, proof code, pending proof ID, Discord ID, issuer, and nonce.
- Removed unsafe contract dependence on local wall-clock timestamps for proof creation and strict expiry behavior.
- GenLayer consensus stores structured evidence and maintains proof health over time.

