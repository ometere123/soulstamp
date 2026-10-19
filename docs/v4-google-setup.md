# Google OIDC setup

Create a Google Cloud OAuth client for a Web application. Configure the exact
Worker callback:

`https://soulstamp-discord.delealufejoel.workers.dev/api/google/callback`

The Worker requests only `openid email profile`. It exchanges the authorization
code server-side and validates the ID token's issuer, audience, authorized
party, RS256 signature from Google's current JWKS, `nonce`, `iat`, `exp` and
`email_verified`. It uses the stable numeric `sub`, never the email address,
as input to a separate Worker-held HMAC commitment key.

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

Until a real Google Cloud client and a real OAuth callback succeed, the live
status is `BLOCKED_EXTERNAL_CREDENTIALS`; local signed-token tests do not count
as a live Google verification.

