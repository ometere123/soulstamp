const FALLBACK_LOCAL_ORIGIN = "http://localhost:5173";
const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_TOKEN_ENDPOINT = "https://discord.com/api/oauth2/token";
const DISCORD_EPOCH_MS = 1420070400000n;
const SESSION_TTL_SECONDS = 10 * 60;
const ATTESTATION_TTL_SECONDS = 10 * 60;

function publicBaseUrl(env) {
  return (env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

function frontendOrigin(env) {
  return (env.FRONTEND_ORIGIN || FALLBACK_LOCAL_ORIGIN).replace(/\/$/, "");
}

function discordRedirectUri(env) {
  return env.DISCORD_REDIRECT_URI || `${publicBaseUrl(env)}/api/discord/callback`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function base64urlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(input) {
  const padded = String(input).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(value, env) {
  const key = await hmacKey(env.BACKEND_SESSION_SECRET || "dev-only-change-me");
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64urlEncode(new Uint8Array(signature));
}

function timingSafeEqualString(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function makeToken(payload, env) {
  const body = base64urlEncode(JSON.stringify(payload));
  return `${body}.${await sign(body, env)}`;
}

async function verifyToken(token, purpose, env) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) throw new Error("Invalid signed token");

  const expected = await sign(body, env);
  if (!timingSafeEqualString(signature, expected)) {
    throw new Error("Invalid signed token signature");
  }

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  if (payload.purpose !== purpose) throw new Error("Invalid signed token purpose");
  if (!payload.exp || payload.exp < nowSeconds()) throw new Error("Signed token expired");
  return payload;
}

function json(body, status, env, extraHeaders = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": frontendOrigin(env),
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
    },
  });
}

function isAllowedReturnTo(raw, env) {
  try {
    const target = new URL(raw);
    const allowed = new URL(frontendOrigin(env));
    return target.origin === allowed.origin;
  } catch {
    return false;
  }
}

function appendParams(rawUrl, params) {
  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function discordAvatarUrl(user) {
  if (!user.avatar) return "";
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

function discordCreatedAtMs(id) {
  try {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
  } catch {
    return 0;
  }
}

function discordAccountAgeYears(id) {
  const createdAtMs = discordCreatedAtMs(id);
  if (!createdAtMs) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAtMs) / (365.25 * 24 * 60 * 60 * 1000)));
}

function cleanDisplayPart(value) {
  return String(value || "")
    .replace(/[#\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function discordClaim(user) {
  const display = cleanDisplayPart(user.global_name || user.username || "discord");
  return `${display || "discord"}#${user.id}`;
}

function requireConfig(env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !discordRedirectUri(env)) {
    throw new Error("Discord OAuth is not configured");
  }
  if (!publicBaseUrl(env).startsWith("https://") && !publicBaseUrl(env).startsWith("http://localhost")) {
    throw new Error("PUBLIC_BASE_URL must be public HTTPS for GenLayer validators");
  }
}

async function handleStart(url, env) {
  requireConfig(env);
  const returnTo = url.searchParams.get("return_to") || frontendOrigin(env);
  if (!isAllowedReturnTo(returnTo, env)) throw new Error("Invalid return_to URL");

  const state = await makeToken({
    purpose: "discord_oauth_state",
    nonce: crypto.randomUUID(),
    wallet: String(url.searchParams.get("wallet") || "").toLowerCase(),
    return_to: returnTo,
    exp: nowSeconds() + SESSION_TTL_SECONDS,
  }, env);

  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", discordRedirectUri(env));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify email");
  authorize.searchParams.set("state", state);
  return redirect(authorize.toString());
}

async function handleCallback(url, env) {
  let state;
  try {
    requireConfig(env);
    state = await verifyToken(url.searchParams.get("state"), "discord_oauth_state", env);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Missing Discord OAuth code");

    const tokenRes = await fetch(DISCORD_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: discordRedirectUri(env),
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Discord token exchange failed: ${text}`);
    }

    const token = await tokenRes.json();
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) {
      const text = await userRes.text();
      throw new Error(`Discord user fetch failed: ${text}`);
    }

    const user = await userRes.json();
    const sessionToken = await makeToken({
      purpose: "discord_session",
      wallet: String(state.wallet || "").toLowerCase(),
      user: {
        id: user.id,
        username: user.username || "",
        global_name: user.global_name || "",
        avatar: user.avatar || "",
        verified: Boolean(user.verified),
      },
      exp: nowSeconds() + SESSION_TTL_SECONDS,
    }, env);

    return redirect(appendParams(state.return_to, {
      discord_session: sessionToken,
      discord_id: user.id,
      discord_username: user.username,
      discord_display: user.global_name || user.username || user.id,
      discord_claim: discordClaim(user),
    }));
  } catch (error) {
    const fallback = state?.return_to && isAllowedReturnTo(state.return_to, env)
      ? state.return_to
      : frontendOrigin(env);
    return redirect(appendParams(fallback, { discord_error: error.message || "Discord OAuth failed" }));
  }
}

async function handleAttest(request, env) {
  const body = await request.json().catch(() => ({}));
  const session = await verifyToken(String(body.session_id || ""), "discord_session", env);

  const wallet = String(body.wallet || "").toLowerCase();
  const verificationCode = String(body.verification_code || "").trim();
  const claimedUsername = String(body.claimed_username || "").trim();
  const claimedParts = claimedUsername.split("#");
  const claimedId = claimedParts[claimedParts.length - 1];

  if (session.wallet && wallet !== session.wallet) {
    return json({ error: "Wallet does not match the Discord OAuth session." }, 400, env);
  }
  if (!/^0x[a-f0-9]{40}$/i.test(wallet)) {
    return json({ error: "Invalid wallet address." }, 400, env);
  }
  if (!/^SOULSTAMP-VERIFY-[A-F0-9]{12}$/i.test(verificationCode)) {
    return json({ error: "Invalid SoulStamp verification code." }, 400, env);
  }
  if (claimedId !== session.user.id) {
    return json({ error: "Claimed Discord user does not match the OAuth account." }, 400, env);
  }

  const now = nowSeconds();
  const accountCreatedAtMs = discordCreatedAtMs(session.user.id);
  const attestation = {
    platform: "discord",
    method: "discord_oauth_identify",
    wallet,
    verification_code: verificationCode,
    discord_id: session.user.id,
    username: session.user.username || "",
    global_name: session.user.global_name || "",
    display_name: session.user.global_name || session.user.username || session.user.id,
    claimed_username: claimedUsername,
    profile_url: `https://discord.com/users/${session.user.id}`,
    avatar_url: discordAvatarUrl(session.user),
    email_verified: Boolean(session.user.verified),
    account_created_at: accountCreatedAtMs ? new Date(accountCreatedAtMs).toISOString() : "",
    account_age_years: discordAccountAgeYears(session.user.id),
    issued_at: now,
    expires_at: now + ATTESTATION_TTL_SECONDS,
  };

  const attestationToken = await makeToken({
    purpose: "discord_attestation",
    attestation,
    exp: attestation.expires_at + 3600,
  }, env);

  return json({
    attestation_url: `${publicBaseUrl(env)}/api/discord/attestations/${attestationToken}`,
    expires_at: attestation.expires_at,
    discord_id: session.user.id,
    claimed_username: claimedUsername,
  }, 201, env);
}

async function handleGetAttestation(pathname, env) {
  const token = pathname.split("/").pop();
  const payload = await verifyToken(token, "discord_attestation", env);
  return json(payload.attestation, 200, env);
}

async function router(request, env) {
  if (request.method === "OPTIONS") return json({}, 204, env);

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (request.method === "GET" && (path === "/health" || path === "/api/health")) {
      return json({
        ok: true,
        public_base_url: publicBaseUrl(env),
        frontend_origin: frontendOrigin(env),
        discord_configured: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
        storage: "stateless-signed-attestations",
      }, 200, env);
    }
    if (request.method === "GET" && path === "/api/discord/start") return await handleStart(url, env);
    if (request.method === "GET" && path === "/api/discord/callback") return await handleCallback(url, env);
    if (request.method === "POST" && path === "/api/discord/attest") return await handleAttest(request, env);
    if (request.method === "GET" && path.startsWith("/api/discord/attestations/")) {
      return await handleGetAttestation(path, env);
    }
    return json({ error: "Not found" }, 404, env);
  } catch (error) {
    console.error("[soulstamp-discord]", error);
    return json({ error: error.message || "Unexpected server error" }, 500, env);
  }
}

export default {
  fetch: router,
};
