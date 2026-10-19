# Google OIDC setup

Create a Google Cloud OAuth client for a Web application. Configure the exact
Worker callback:

`https://soulstamp-discord.delealufejoel.workers.dev/api/google/callback`

The Worker requests only `openid email profile`. It exchanges the authorization
code server-side and validates the ID token's issuer, audience, authorized
party, RS256 signature from Google's current JWKS, `nonce`, `iat`, `exp` and
`email_verified`. It uses the stable numeric `sub`, never the email address,
as input to a separate Worker-held HMAC commitment key.

The Worker accepts Google's normal approximately one-hour ID-token lifetime
with a bounded clock-skew allowance, while still rejecting expired tokens,
future-issued tokens and tokens whose lifetime exceeds the configured maximum.
Issuer, audience, signature, nonce and verified-email checks remain mandatory.

Set these Worker values without putting them in Vercel or the repository:

```text
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_ACCOUNT_COMMITMENT_SECRET
wrangler secret put BACKEND_SESSION_SECRET
```

Set the public client ID and callback in the Worker environment. The
commitment secret must be at least 32 random characters and must not be reused
as the Discord signing/session secret. A key rotation needs a versioned
commitment migration policy; changing the secret does not silently make the
same Google account available to another wallet.

The current Worker health endpoint reports Google configured and the exact
callback URL. The live identity status remains
`CONFIGURED_NOT_ACCOUNT_VERIFIED` until a consenting user completes the real
OAuth callback and wallet-bound `link_google_attestation` transaction; local
signed-token tests do not count as live Google verification.

## Frontend callback handoff

The Vercel Production and Preview builds use the Worker URL for both Google
and Discord. On a successful Google callback the frontend captures the
short-lived signed evidence in browser session storage, removes
`google_attestation_url` and related callback parameters from browser history,
and routes to the TrustPass tab. It restores only the request named by
`google_pending_id` and requires the bound wallet to reconnect. The user then
selects **Complete Google linking**. The UI reports Linked only after the V4
write is finalized successfully and a fresh `get_request` read contains the
Google commitment. Expired evidence, a missing request, or a different wallet
is rejected and can be retried through a new OAuth flow.

Discord callback parameters continue to route to Verify Identity and use the
existing Worker lifecycle. The legacy Cloud Function endpoint was checked
read-only and returned HTTP 404 for its health and OAuth routes; it is not the
active frontend backend.

A read-only authorization-start smoke check reached Google’s authorization
endpoint with HTTP 302 and Discord’s endpoint with HTTP 200 using the exact
Worker-generated callback values. This confirms the live start requests are
well formed; it is not a substitute for a consenting user login or an
on-chain Google-link transaction.
