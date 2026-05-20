# SoulStamp

**On-Chain Identity Verification Platform** powered by GenLayer Intelligent Contracts.

Users verify their real-world social media identity by posting a system-generated code on their profile. GenLayer LLMs autonomously fetch and validate the post — no oracles, no manual review — then cryptographically link the verified identity to their wallet address.

---

## Features

| Feature | Description |
|---|---|
| Social media linking | GitHub, Twitter/X, and Discord |
| Unique verification codes | Timestamped, address-scoped per request |
| AI-powered validation | GenLayer validators fetch public proofs or Discord attestations |
| On-chain identity registry | Immutable, tamper-resistant linked accounts |
| Sybil resistance | One social account → one wallet, enforced on-chain |
| Bot detection | LLM scores bot probability; auto-flags suspicious accounts |
| Reputation scoring | Weighted rolling average across all verified accounts |
| Revocation | Admin-only moderation revoke |
| Verification expiry | Codes expire after 7 days |
| Admin moderation | Flag / unflag identities with audit trail |
| Public directory | Look up any address or social account |
| Full audit trail | Every action is logged on-chain |
| Developer API | All state is queryable via GenLayerJS |

---

## Verification Flow

```
1. request_verification(platform, username, profile_url)
       │
       └─► Generates unique code: SOULSTAMP-VERIFY-XXXXXXXXXX
           Stored on-chain with 7-day expiry

2. User posts the code publicly on their profile, or connects Discord through OAuth

3. complete_verification()
       │
       ├─► GenLayer fetches GitHub API, Twitter oEmbed, or Discord attestation JSON
       ├─► Validates the exact code is present
       ├─► Scores identity confidence & bot probability
       ├─► All validators independently re-run (Optimistic Democracy)
       └─► If consensus reached: linked account recorded on-chain
```

---

## AI Evaluation

The LLM analysis returns structured JSON covering:

- `verification_code_found` — exact string match required
- `account_age_category` — new / moderate / established
- `post_activity_level` — none / low / moderate / high
- `bot_indicators` — specific patterns detected
- `bot_confidence` — 0 (human) to 100 (bot)
- `identity_confidence` — overall trustworthiness 0–100
- `reasoning` — one-sentence verdict

Validators must agree on the binary `verification_code_found` result, and numeric scores must be within ±25 to reach consensus.

---

## Project Structure

```
SoulStamp/
├── contracts/
│   └── soul_stamp.py          # GenLayer Intelligent Contract (Python)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── VerificationFlow.tsx
│   │   │   ├── PublicLookup.tsx
│   │   │   ├── AuditTrail.tsx
│   │   │   └── AdminPanel.tsx
│   │   ├── lib/
│   │   │   ├── client.ts      # GenLayerJS client & wallet
│   │   │   └── contract.ts    # Contract read/write helpers
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example
├── tests/
│   └── test_soul_stamp.py     # pytest test suite
└── README.md
```

---

## Getting Started

### Prerequisites

```bash
npm install -g genlayer
```

### 1. Start local GenLayer node

```bash
genlayer up
```

### 2. Deploy the contract

```bash
genlayer deploy contracts/soul_stamp.py
# Copy the contract address output
```

### 3. Configure the frontend

```bash
cd frontend
cp .env.example .env
# Edit .env: set VITE_CONTRACT_ADDRESS to the deployed address
```

### 4. Install and run

```bash
npm install
npm run dev
```

### 5. Deploy Discord backend on Cloudflare Workers

Discord verification needs a Discord application and a public Cloudflare Worker URL reachable by GenLayer validators. The contract does not need to change.

The backend is stateless: it signs short-lived Discord session and attestation tokens instead of using a database.

Install backend dependencies:

```bash
cd backend
npm install
```

Update `backend/wrangler.toml`:

```toml
[vars]
FRONTEND_ORIGIN = "https://your-vercel-frontend.vercel.app"
PUBLIC_BASE_URL = "https://soulstamp-discord.your-cloudflare-subdomain.workers.dev"
DISCORD_CLIENT_ID = "your-discord-client-id"
DISCORD_REDIRECT_URI = "https://soulstamp-discord.your-cloudflare-subdomain.workers.dev/api/discord/callback"
```

Store secrets in Cloudflare:

```bash
npx wrangler secret put BACKEND_SESSION_SECRET
npx wrangler secret put DISCORD_CLIENT_SECRET
```

Deploy the Worker:

```bash
npm run deploy
```

Vercel frontend environment variables:

```bash
VITE_CONTRACT_ADDRESS=0x80e1EDb6996483E7050bb81B4D1a54dD69879719
VITE_DISCORD_BACKEND_URL=https://soulstamp-discord.your-cloudflare-subdomain.workers.dev
```

In Discord Developer Portal, add this exact redirect URI:

```text
https://soulstamp-discord.your-cloudflare-subdomain.workers.dev/api/discord/callback
```

In the SoulStamp Admin panel, set Discord attestation backend to:

```text
https://soulstamp-discord.your-cloudflare-subdomain.workers.dev
```

### 6. Run tests

```bash
genlayer test tests/
```

---

## Contract API Reference

### Write Methods

| Method | Args | Description |
|---|---|---|
| `request_verification` | `platform, username, profile_url` | Step 1: generates verification code |
| `complete_verification` | `fetch_url` | Step 2: fetches proof source, validates, records |
| `cancel_pending_verification` | — | Cancel an in-progress request |
| `revoke_platform` | `platform, username` | Remove a verified account link |
| `flag_identity` | `target, reason` | Admin: flag suspicious identity |
| `unflag_identity` | `target` | Admin: clear flag |
| `set_discord_attestation_base_url` | `base_url` | Admin: trusted Discord backend URL |
| `transfer_admin` | `new_admin` | Transfer admin role |

### View Methods

| Method | Args | Returns |
|---|---|---|
| `get_identity` | `address` | Full identity record |
| `get_pending_verification` | `address` | Pending code to post |
| `lookup_by_platform` | `platform, username` | Which address owns this account |
| `is_platform_taken` | `platform, username` | Sybil check |
| `get_audit_log` | `address` | Full action history |
| `get_all_addresses` | `offset, limit` | Paginated address registry |
| `get_stats` | — | Platform-wide statistics |

---

## Supported Platforms

- **GitHub** — code detected in public user API bio
- **Twitter / X** — code detected from a public tweet through Twitter oEmbed
- **Discord** — OAuth identity attested by the SoulStamp Discord backend

---

## Security Notes

- Verification codes are SHA-256 derived from `address + platform + username + block_timestamp` — not guessable or reusable
- Sybil protection is enforced at the smart contract level, not application level
- The LLM uses the profile HTML content, not API tokens — no privileged access required
- All validator decisions are recorded via GenLayer's Optimistic Democracy consensus
