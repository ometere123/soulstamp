const FALLBACK_LOCAL_ORIGIN = "http://localhost:5173";
const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_TOKEN_ENDPOINT = "https://discord.com/api/oauth2/token";
const DISCORD_EPOCH_MS = 1420070400000n;
const SESSION_TTL_SECONDS = 10 * 60;
const ATTESTATION_TTL_SECONDS = 5 * 60;
const SIGNED_TOKEN_MAX_LENGTH = 4096;
const GOOGLE_CHAIN_ID = "61999";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_DISCOVERY_ENDPOINT = "https://accounts.google.com/.well-known/openid-configuration";
const GOOGLE_SCOPE = "openid email profile";
const PASSPORT_API_ENDPOINT = "https://api.passport.xyz/v2/stamps";
// The official docs list the bedrock host, but this operational EASSCAN host
// is the one currently resolving for Optimism Sepolia. It is still only a
// candidate index; direct EAS eth_call validation remains authoritative.
const PASSPORT_GRAPHQL_ENDPOINT = "https://optimism-sepolia.easscan.org/graphql";
const PASSPORT_CHAIN_ID = 11155420;
const PASSPORT_APPROVED_SCHEMA = "0x81d8758ccd97bbeea7642df29001f6046a676b3c24f808c4297db5ee36838dd8";
const PASSPORT_APPROVED_ATTESTER = "0x8b1a76795e3cbadd79c5410d2c4d4827d9c1503a";
const PASSPORT_APPROVED_SCORER_ID = "335";
const PASSPORT_API_TIMEOUT_MS = 8_000;
const PASSPORT_GRAPHQL_TIMEOUT_MS = 8_000;
const PASSPORT_MAX_RESPONSE_BYTES = 256 * 1024;
const PASSPORT_QUERY_LIMIT = 25;
const PASSPORT_RATE_WINDOW_SECONDS = 60;
const PASSPORT_RATE_LIMIT = 12;
const passportRateBuckets = new Map();
// Google ID tokens normally live for about one hour.  Keep a bounded upper
// limit with a small operational margin; do not accept arbitrary long-lived
// bearer tokens.
const GOOGLE_ID_TOKEN_MAX_LIFETIME_SECONDS = 60 * 60 + 5 * 60;

function publicBaseUrl(env) {
  return (env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

function frontendOrigin(env) {
  return (env.FRONTEND_ORIGIN || FALLBACK_LOCAL_ORIGIN).replace(/\/$/, "");
}

function discordRedirectUri(env) {
  return env.DISCORD_REDIRECT_URI || `${publicBaseUrl(env)}/api/discord/callback`;
}

function googleRedirectUri(env) {
  return env.GOOGLE_REDIRECT_URI || `${publicBaseUrl(env)}/api/google/callback`;
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

function utf8(value) {
  return new TextEncoder().encode(String(value));
}

function hexEncode(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", utf8(verifier));
  return base64urlEncode(new Uint8Array(digest));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64urlEncode(value);
}

async function hmacKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("BACKEND_SESSION_SECRET must be configured with at least 32 characters");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function commitmentKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("GOOGLE_ACCOUNT_COMMITMENT_SECRET must be configured with at least 32 characters");
  }
  return crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function googleCommitment(subject, env) {
  const key = await commitmentKey(env.GOOGLE_ACCOUNT_COMMITMENT_SECRET);
  const material = `v1|google-sub|${subject}`;
  const digest = await crypto.subtle.sign("HMAC", key, utf8(material));
  return `v1:${hexEncode(new Uint8Array(digest))}`;
}

async function sign(value, env) {
  const key = await hmacKey(env.BACKEND_SESSION_SECRET);
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
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new Error("Invalid signed token");
  const [body, signature] = parts;
  if (!body || !signature || String(token).length > SIGNED_TOKEN_MAX_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(String(token))) {
    throw new Error("Invalid signed token");
  }

  const expected = await sign(body, env);
  if (!timingSafeEqualString(signature, expected)) {
    throw new Error("Invalid signed token signature");
  }

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  if (payload.purpose !== purpose) throw new Error("Invalid signed token purpose");
  if (!payload.exp || payload.exp <= nowSeconds()) throw new Error("Signed token expired");
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
  if (typeof env.BACKEND_SESSION_SECRET !== "string" || env.BACKEND_SESSION_SECRET.length < 32) {
    throw new Error("BACKEND_SESSION_SECRET must be configured with at least 32 characters");
  }
  if (!publicBaseUrl(env).startsWith("https://") && !publicBaseUrl(env).startsWith("http://localhost")) {
    throw new Error("PUBLIC_BASE_URL must be public HTTPS for GenLayer validators");
  }
}

function requireGoogleConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !googleRedirectUri(env)) {
    throw new Error("Google OAuth is not configured");
  }
  if (typeof env.BACKEND_SESSION_SECRET !== "string" || env.BACKEND_SESSION_SECRET.length < 32) {
    throw new Error("BACKEND_SESSION_SECRET must be configured with at least 32 characters");
  }
  if (typeof env.GOOGLE_ACCOUNT_COMMITMENT_SECRET !== "string" || env.GOOGLE_ACCOUNT_COMMITMENT_SECRET.length < 32) {
    throw new Error("GOOGLE_ACCOUNT_COMMITMENT_SECRET must be configured with at least 32 characters");
  }
  if (!publicBaseUrl(env).startsWith("https://") && !publicBaseUrl(env).startsWith("http://localhost")) {
    throw new Error("PUBLIC_BASE_URL must be public HTTPS for Google validators");
  }
}

function requireWallet(value, label = "wallet") {
  const wallet = String(value || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) throw new Error(`Invalid ${label} address`);
  return wallet;
}

function requireV4Address(value) {
  const address = String(value || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid V4 contract address");
  return address;
}

function requirePassportWallet(value) {
  const wallet = String(value || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error("Invalid Passport wallet address");
  return wallet;
}

function passportScorerId(env) {
  const value = String(env.PASSPORT_SCORER_ID || "").trim();
  if (!/^[0-9]{1,12}$/.test(value)) throw new Error("PASSPORT_SCORER_ID is not configured");
  return value;
}

function passportConfig(env) {
  return Boolean(String(env.PASSPORT_API_KEY || "").trim() && String(env.PASSPORT_SCORER_ID || "").trim());
}

function passportRateKey(request, wallet) {
  const forwarded = String(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  return `${forwarded.slice(0, 96)}|${wallet.toLowerCase()}`;
}

function consumePassportRateLimit(request, wallet) {
  const now = nowSeconds();
  const key = passportRateKey(request, wallet);
  const current = passportRateBuckets.get(key);
  if (!current || current.expiresAt <= now) {
    if (passportRateBuckets.size >= 2048) {
      for (const [candidate, bucket] of passportRateBuckets) {
        if (bucket.expiresAt <= now) passportRateBuckets.delete(candidate);
      }
    }
    passportRateBuckets.set(key, { count: 1, expiresAt: now + PASSPORT_RATE_WINDOW_SECONDS });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  return { allowed: current.count <= PASSPORT_RATE_LIMIT, retryAfter: Math.max(1, current.expiresAt - now) };
}

async function fetchJsonBounded(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > PASSPORT_MAX_RESPONSE_BYTES) throw new Error("Passport upstream response is too large");
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { throw new Error("Passport upstream response is not valid JSON"); }
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

function finiteNumber(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const result = typeof value === "number" ? value : Number(String(value ?? ""));
  if (!Number.isFinite(result) || result < 0 || result > maximum) throw new Error(`${label} is malformed`);
  return result;
}

function safePassportApiResult(body, scorerId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Passport score response is malformed");
  const scoreValue = body.score === undefined || body.score === null || body.score === "" ? null : finiteNumber(body.score, "Passport score", 100);
  const passingScore = typeof body.passing_score === "boolean" ? body.passing_score : null;
  const rawStamps = Array.isArray(body.stamps) ? body.stamps : body.stamps && typeof body.stamps === "object" ? Object.entries(body.stamps).map(([provider, score]) => ({ provider, score })) : [];
  const stamps = rawStamps.slice(0, 128).map((stamp) => {
    if (!stamp || typeof stamp !== "object") return null;
    const provider = String(stamp.provider || stamp.type || "").replace(/[\r\n]/g, " ").slice(0, 128);
    const parsedStampScore = stamp.score === undefined || stamp.score === null ? null : Number(stamp.score);
    const stampScore = Number.isFinite(parsedStampScore) && parsedStampScore >= 0 && parsedStampScore <= 100 ? parsedStampScore : null;
    return provider ? { provider, score: stampScore } : null;
  }).filter(Boolean);
  const timestamp = body.last_score_timestamp === undefined || body.last_score_timestamp === null ? null : String(body.last_score_timestamp).slice(0, 96);
  const expiration = body.expiration_timestamp === undefined && body.expiration_time === undefined
    ? null
    : finiteNumber(body.expiration_timestamp ?? body.expiration_time, "Passport expiration timestamp");
  return {
    available: true,
    scorer_id: scorerId,
    matches_approved_scorer: scorerId === PASSPORT_APPROVED_SCORER_ID,
    score: scoreValue,
    passing_score: passingScore,
    stamp_count: stamps.length,
    stamps,
    last_score_timestamp: timestamp,
    expiration_timestamp: expiration,
  };
}

function safeGraphqlCandidate(value, wallet) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").toLowerCase();
  const recipient = String(value.recipient || "").toLowerCase();
  const schemaId = String(value.schemaId || "").toLowerCase();
  const attester = String(value.attester || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(id) || recipient !== wallet.toLowerCase() || schemaId !== PASSPORT_APPROVED_SCHEMA) return null;
  if (attester !== PASSPORT_APPROVED_ATTESTER) return null;
  return {
    attestation_uid: id,
    recipient,
    schema_uid: schemaId,
    attester,
    time: finiteNumber(value.time, "Passport attestation time"),
    expiration_time: finiteNumber(value.expirationTime ?? 0, "Passport attestation expiration"),
    revocation_time: finiteNumber(value.revocationTime ?? 0, "Passport attestation revocation"),
    revocable: Boolean(value.revocable),
  };
}

async function fetchPassportApi(wallet, env) {
  const scorerId = passportScorerId(env);
  const result = await fetchJsonBounded(`${PASSPORT_API_ENDPOINT}/${encodeURIComponent(scorerId)}/score/${encodeURIComponent(wallet.toLowerCase())}`, {
    headers: { "X-API-Key": String(env.PASSPORT_API_KEY), accept: "application/json", "user-agent": "SoulStamp-Passport-Discovery/4.2" },
  }, PASSPORT_API_TIMEOUT_MS);
  if (!result.response.ok) throw new Error(result.response.status === 429 ? "Passport API rate limit" : `Passport API HTTP ${result.response.status}`);
  return safePassportApiResult(result.body, scorerId);
}

async function fetchPassportCandidates(wallet, env) {
  const endpoint = String(env.PASSPORT_GRAPHQL_URL || PASSPORT_GRAPHQL_ENDPOINT);
  if (endpoint !== PASSPORT_GRAPHQL_ENDPOINT) throw new Error("Passport indexer endpoint is not approved");
  const query = `query PassportAttestations($recipient: String!, $schemaId: String!, $take: Int!) {
    attestations(
      where: { recipient: { equals: $recipient }, schemaId: { equals: $schemaId } }
      take: $take
      orderBy: { time: desc }
    ) {
      id
      attester
      recipient
      schemaId
      revocable
      revocationTime
      expirationTime
      time
    }
  }`;
  const result = await fetchJsonBounded(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables: { recipient: wallet, schemaId: PASSPORT_APPROVED_SCHEMA, take: PASSPORT_QUERY_LIMIT } }),
  }, PASSPORT_GRAPHQL_TIMEOUT_MS);
  if (!result.response.ok) throw new Error(`Passport indexer HTTP ${result.response.status}`);
  if (Array.isArray(result.body?.errors) && result.body.errors.length) throw new Error("Passport indexer query failed");
  const records = Array.isArray(result.body?.data?.attestations) ? result.body.data.attestations : [];
  const candidates = records.map((record) => safeGraphqlCandidate(record, wallet)).filter(Boolean);
  candidates.sort((left, right) => right.time - left.time || left.attestation_uid.localeCompare(right.attestation_uid));
  return { endpoint, candidates: candidates.slice(0, PASSPORT_QUERY_LIMIT) };
}

function upstreamErrorCode(error, prefix) {
  const message = String(error?.message || "");
  const status = message.match(/HTTP (\d{3})/i)?.[1];
  if (status) return `${prefix}_HTTP_${status}`;
  if (/rate limit/i.test(message)) return `${prefix}_RATE_LIMIT`;
  if (/abort|timeout/i.test(message)) return `${prefix}_TIMEOUT`;
  return `${prefix}_UNAVAILABLE`;
}

async function handlePassportDiscover(request, url, env) {
  const wallet = requirePassportWallet(url.searchParams.get("wallet"));
  const rate = consumePassportRateLimit(request, wallet);
  if (!rate.allowed) return json({ error: "Passport discovery rate limit exceeded", code: "RATE_LIMITED" }, 429, env, { "retry-after": String(rate.retryAfter) });
  if (!passportConfig(env)) return json({ error: "Passport discovery is not configured", code: "PASSPORT_NOT_CONFIGURED" }, 503, env);

  const [apiResult, indexerResult] = await Promise.allSettled([fetchPassportApi(wallet, env), fetchPassportCandidates(wallet, env)]);
  const api = apiResult.status === "fulfilled" ? apiResult.value : { available: false, error_code: upstreamErrorCode(apiResult.reason, "PASSPORT_API") };
  const indexer = indexerResult.status === "fulfilled" ? indexerResult.value : { endpoint: PASSPORT_GRAPHQL_ENDPOINT, candidates: [], error_code: upstreamErrorCode(indexerResult.reason, "PASSPORT_INDEXER") };
  return json({
    wallet: wallet.toLowerCase(),
    chain_id: PASSPORT_CHAIN_ID,
    approved_schema_uid: PASSPORT_APPROVED_SCHEMA,
    approved_attester: PASSPORT_APPROVED_ATTESTER,
    approved_scorer_id: Number(PASSPORT_APPROVED_SCORER_ID),
    passport_api: api,
    eas_indexer: indexer,
    candidate: indexer.candidates?.[0] || null,
    candidate_count: indexer.candidates?.length || 0,
    authority: "candidate_only_until_direct_eas_validation",
  }, 200, env);
}

function requirePendingId(value) {
  const pending = String(value || "").trim().toUpperCase();
  if (!/^[A-F0-9]{24,64}$/.test(pending)) throw new Error("Invalid Google pending request ID");
  return pending;
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error("Malformed Google ID token");
  }
  try {
    return {
      header: JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0]))),
      claims: JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1]))),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64urlDecode(parts[2]),
    };
  } catch {
    throw new Error("Malformed Google ID token");
  }
}

async function googleJwks(env) {
  const discoveryResponse = await fetch(GOOGLE_DISCOVERY_ENDPOINT, { headers: { accept: "application/json" } });
  if (!discoveryResponse.ok) throw new Error("Google OIDC discovery is unavailable");
  const discovery = await discoveryResponse.json();
  const jwksUri = String(discovery.jwks_uri || "");
  if (!/^https:\/\/(www\.)?googleapis\.com\//.test(jwksUri)) throw new Error("Google JWKS origin is not trusted");
  const response = await fetch(jwksUri, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Google signing keys are unavailable");
  const body = await response.json();
  if (!Array.isArray(body.keys) || body.keys.length > 20) throw new Error("Google signing keys are malformed");
  return body.keys;
}

async function validateGoogleIdToken(idToken, state, env) {
  const parsed = parseJwt(idToken);
  const header = parsed.header || {};
  const claims = parsed.claims || {};
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Google ID token algorithm or key ID is invalid");
  const issuer = String(claims.iss || "");
  if (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") throw new Error("Google ID token issuer is invalid");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.GOOGLE_CLIENT_ID)) throw new Error("Google ID token audience is invalid");
  if (claims.azp && claims.azp !== env.GOOGLE_CLIENT_ID) throw new Error("Google ID token authorized party is invalid");
  const now = nowSeconds();
  if (!Number.isInteger(claims.exp) || claims.exp <= now || claims.exp > now + GOOGLE_ID_TOKEN_MAX_LIFETIME_SECONDS) throw new Error("Google ID token is expired or too long-lived");
  if (!Number.isInteger(claims.iat) || claims.iat > now + 60 || claims.iat < now - 15 * 60) throw new Error("Google ID token issued-at time is invalid");
  if (claims.exp - claims.iat > GOOGLE_ID_TOKEN_MAX_LIFETIME_SECONDS) throw new Error("Google ID token lifetime is too long");
  if (claims.nonce !== state.nonce) throw new Error("Google ID token nonce mismatch");
  if (claims.email_verified !== true) throw new Error("Google account email is not verified");
  if (!/^[0-9]+$/.test(String(claims.sub || ""))) throw new Error("Google stable subject is missing");
  const keys = await googleJwks(env);
  const jwk = keys.find((key) => key && key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("Google signing key was not found");
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, parsed.signature, utf8(parsed.signingInput));
  if (!valid) throw new Error("Google ID token signature is invalid");
  return claims;
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
  const pendingId = String(body.pending_id || "").trim().toUpperCase();
  const claimedParts = claimedUsername.split("#");
  const claimedId = claimedParts[claimedParts.length - 1];

  if (session.wallet && wallet !== session.wallet) {
    return json({ error: "Wallet does not match the Discord OAuth session." }, 400, env);
  }
  if (!/^0x[a-f0-9]{40}$/i.test(wallet)) {
    return json({ error: "Invalid wallet address." }, 400, env);
  }
  if (!/^SOULSTAMP-(VERIFY|CHALLENGE|REBUT)-[A-F0-9]{12}$/i.test(verificationCode)) {
    return json({ error: "Invalid SoulStamp evidence code." }, 400, env);
  }
  if (!/^[A-F0-9]{24}$/i.test(pendingId)) {
    return json({ error: "Invalid SoulStamp pending proof ID." }, 400, env);
  }
  if (claimedId !== session.user.id) {
    return json({ error: "Claimed Discord user does not match the OAuth account." }, 400, env);
  }

  const now = nowSeconds();
  if (session.exp <= now) {
    return json({ error: "Discord OAuth session has expired. Reconnect Discord." }, 401, env);
  }
  const accountCreatedAtMs = discordCreatedAtMs(session.user.id);
  const attestation = {
    platform: "discord",
    method: "discord_oauth_identify",
    issuer: publicBaseUrl(env),
    pending_id: pendingId,
    nonce: crypto.randomUUID(),
    attestation_id: crypto.randomUUID(),
    wallet,
    verification_code: verificationCode,
    discord_user_id: session.user.id,
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
    // The signed URL expires at the same moment as the attestation payload.
    // The contract also consumes the nonce after successful use.
    exp: attestation.expires_at,
  }, env);
  attestation.attestation_token_hint = attestationToken.slice(-16);

  return json({
    attestation_url: `${publicBaseUrl(env)}/api/discord/attestations/${attestationToken}`,
    expires_at: attestation.expires_at,
    pending_id: pendingId,
    wallet,
    verification_code: verificationCode,
    discord_id: session.user.id,
    claimed_username: claimedUsername,
  }, 201, env);
}

async function handleGetAttestation(pathname, env) {
  const token = pathname.split("/").pop();
  const payload = await verifyToken(token, "discord_attestation", env);
  if (!payload.attestation || payload.attestation.expires_at <= nowSeconds()) {
    throw new Error("Discord attestation expired");
  }
  return json(payload.attestation, 200, env);
}

async function handleGoogleStart(url, env) {
  requireGoogleConfig(env);
  const returnTo = url.searchParams.get("return_to") || frontendOrigin(env);
  if (!isAllowedReturnTo(returnTo, env)) throw new Error("Invalid return_to URL");
  const wallet = requireWallet(url.searchParams.get("wallet"));
  const v4Contract = requireV4Address(url.searchParams.get("v4_contract"));
  const pendingId = requirePendingId(url.searchParams.get("pending_id"));
  const purpose = String(url.searchParams.get("purpose") || "google_link");
  if (purpose !== "google_link") throw new Error("Invalid Google OAuth purpose");
  if (String(url.searchParams.get("chain_id") || GOOGLE_CHAIN_ID) !== GOOGLE_CHAIN_ID) throw new Error("Google flow is bound to Studionet 61999");
  const verifier = randomToken(32);
  const nonce = randomToken(24);
  const state = await makeToken({
    purpose: "google_oauth_state",
    nonce,
    wallet,
    pending_id: pendingId,
    v4_contract: v4Contract,
    chain_id: GOOGLE_CHAIN_ID,
    return_to: returnTo,
    code_verifier: verifier,
    exp: nowSeconds() + SESSION_TTL_SECONDS,
  }, env);
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", googleRedirectUri(env));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", GOOGLE_SCOPE);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("code_challenge", await pkceChallenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("access_type", "online");
  authorize.searchParams.set("prompt", "consent");
  return redirect(authorize.toString());
}

async function handleGoogleCallback(url, env) {
  let state;
  try {
    requireGoogleConfig(env);
    state = await verifyToken(url.searchParams.get("state"), "google_oauth_state", env);
    const code = String(url.searchParams.get("code") || "");
    if (!code) throw new Error("Missing Google OAuth code");
    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        code_verifier: state.code_verifier,
        grant_type: "authorization_code",
        redirect_uri: googleRedirectUri(env),
      }),
    });
    if (!tokenResponse.ok) throw new Error("Google OAuth code exchange failed");
    const tokenBody = await tokenResponse.json();
    if (!tokenBody.id_token) throw new Error("Google OAuth response did not contain an ID token");
    // Access tokens are deliberately never persisted or returned. The
    // provider may return one for OIDC, but it is not needed by SoulStamp.
    const claims = await validateGoogleIdToken(tokenBody.id_token, state, env);
    const commitment = await googleCommitment(claims.sub, env);
    const now = nowSeconds();
    const attestation = {
      platform: "google",
      method: "google_oidc_authorization_code",
      issuer: publicBaseUrl(env),
      wallet: state.wallet,
      chain_id: Number(state.chain_id),
      v4_contract: state.v4_contract,
      pending_id: state.pending_id,
      purpose: "google_link",
      nonce: randomToken(24),
      attestation_id: crypto.randomUUID(),
      account_commitment: commitment,
      commitment_version: "v1",
      issued_at: now,
      expires_at: now + ATTESTATION_TTL_SECONDS,
    };
    const evidenceToken = await makeToken({
      purpose: "google_attestation",
      attestation,
      exp: attestation.expires_at,
    }, env);
    return redirect(appendParams(state.return_to, {
      google_status: "ready",
      google_attestation_url: `${publicBaseUrl(env)}/api/google/attestations/${evidenceToken}`,
      google_pending_id: state.pending_id,
    }));
  } catch (error) {
    const fallback = state?.return_to && isAllowedReturnTo(state.return_to, env) ? state.return_to : frontendOrigin(env);
    return redirect(appendParams(fallback, { google_error: error.message || "Google OAuth failed" }));
  }
}

async function handleGoogleAttestation(pathname, env) {
  requireGoogleConfig(env);
  const token = pathname.split("/").pop();
  const payload = await verifyToken(token, "google_attestation", env);
  if (!payload.attestation || payload.attestation.expires_at <= nowSeconds()) throw new Error("Google attestation expired");
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
        google_configured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_ACCOUNT_COMMITMENT_SECRET),
        passport_configured: passportConfig(env),
        passport_api_endpoint: PASSPORT_API_ENDPOINT,
        passport_scorer_id: env.PASSPORT_SCORER_ID ? String(env.PASSPORT_SCORER_ID) : null,
        passport_approved_scorer_id: Number(PASSPORT_APPROVED_SCORER_ID),
        passport_indexer: PASSPORT_GRAPHQL_ENDPOINT,
        google_redirect_uri: googleRedirectUri(env),
        storage: "stateless-signed-attestations",
      }, 200, env);
    }
    if (request.method === "GET" && path === "/api/discord/start") return await handleStart(url, env);
    if (request.method === "GET" && path === "/api/discord/callback") return await handleCallback(url, env);
    if (request.method === "POST" && path === "/api/discord/attest") return await handleAttest(request, env);
    if (request.method === "GET" && path.startsWith("/api/discord/attestations/")) {
      return await handleGetAttestation(path, env);
    }
    if (request.method === "GET" && path === "/api/google/start") return await handleGoogleStart(url, env);
    if (request.method === "GET" && path === "/api/google/callback") return await handleGoogleCallback(url, env);
    if (request.method === "GET" && path.startsWith("/api/google/attestations/")) return await handleGoogleAttestation(path, env);
    if (request.method === "GET" && path === "/api/passport/discover") return await handlePassportDiscover(request, url, env);
    return json({ error: "Not found" }, 404, env);
  } catch (error) {
    console.error("[soulstamp-discord]", error);
    return json({ error: error.message || "Unexpected server error" }, 500, env);
  }
}

export default {
  fetch: router,
};
