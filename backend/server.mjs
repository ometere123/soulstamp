import http from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, URL, URLSearchParams } from "node:url";

function loadEnvFile() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = existsSync(".env") ? ".env" : join(here, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 8787);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${PUBLIC_BASE_URL}/api/discord/callback`;
const BACKEND_SESSION_SECRET = process.env.BACKEND_SESSION_SECRET || "dev-only-change-me";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_TOKEN_ENDPOINT = "https://discord.com/api/oauth2/token";
const DISCORD_EPOCH_MS = 1420070400000n;
const SESSION_TTL_SECONDS = 10 * 60;
const ATTESTATION_TTL_SECONDS = 10 * 60;

const sessions = new Map();
const attestations = new Map();

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": FRONTEND_ORIGIN,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function redirect(res, location) {
  res.writeHead(302, {
    location,
    "cache-control": "no-store",
  });
  res.end();
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sign(value) {
  return base64url(createHmac("sha256", BACKEND_SESSION_SECRET).update(value).digest());
}

function makeState(data) {
  const payload = base64url(JSON.stringify(data));
  return `${payload}.${sign(payload)}`;
}

function verifyState(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw new Error("Invalid OAuth state");
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("Invalid OAuth state signature");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!parsed.exp || parsed.exp < nowSeconds()) throw new Error("OAuth state expired");
  return parsed;
}

function isAllowedReturnTo(raw) {
  try {
    const target = new URL(raw);
    const allowed = new URL(FRONTEND_ORIGIN);
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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
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

function pruneExpired() {
  const now = nowSeconds();
  for (const [id, session] of sessions.entries()) {
    if (session.expires_at < now) sessions.delete(id);
  }
  for (const [id, attestation] of attestations.entries()) {
    if (attestation.expires_at + 3600 < now) attestations.delete(id);
  }
}

function requireDiscordConfig() {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
    throw new Error("Discord OAuth is not configured");
  }
  if (!PUBLIC_BASE_URL.startsWith("https://") && !PUBLIC_BASE_URL.startsWith("http://localhost")) {
    throw new Error("PUBLIC_BASE_URL must be public HTTPS for Studionet validators");
  }
}

async function handleDiscordStart(reqUrl, res) {
  requireDiscordConfig();
  const returnTo = reqUrl.searchParams.get("return_to") || FRONTEND_ORIGIN;
  if (!isAllowedReturnTo(returnTo)) throw new Error("Invalid return_to URL");

  const state = makeState({
    nonce: randomBytes(16).toString("hex"),
    wallet: String(reqUrl.searchParams.get("wallet") || "").toLowerCase(),
    return_to: returnTo,
    exp: nowSeconds() + SESSION_TTL_SECONDS,
  });

  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", DISCORD_REDIRECT_URI);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify email");
  authorize.searchParams.set("state", state);
  redirect(res, authorize.toString());
}

async function handleDiscordCallback(reqUrl, res) {
  const state = verifyState(reqUrl.searchParams.get("state"));
  const code = reqUrl.searchParams.get("code");
  if (!code) throw new Error("Missing Discord OAuth code");

  const tokenRes = await fetch(DISCORD_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: DISCORD_REDIRECT_URI,
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
  const sessionId = randomBytes(24).toString("hex");
  const session = {
    id: sessionId,
    wallet: String(state.wallet || "").toLowerCase(),
    user,
    created_at: nowSeconds(),
    expires_at: nowSeconds() + SESSION_TTL_SECONDS,
  };
  sessions.set(sessionId, session);

  redirect(res, appendParams(state.return_to, {
    discord_session: sessionId,
    discord_id: user.id,
    discord_username: user.username,
    discord_display: user.global_name || user.username || user.id,
    discord_claim: discordClaim(user),
  }));
}

async function handleCreateAttestation(req, res) {
  const body = await readBody(req);
  const session = sessions.get(String(body.session_id || ""));
  if (!session || session.expires_at < nowSeconds()) {
    return json(res, 401, { error: "Discord session expired. Connect Discord again." });
  }

  const wallet = String(body.wallet || "").toLowerCase();
  const verificationCode = String(body.verification_code || "").trim();
  const claimedUsername = String(body.claimed_username || "").trim();
  const claimedParts = claimedUsername.split("#");
  const claimedId = claimedParts[claimedParts.length - 1];

  if (session.wallet && wallet !== session.wallet) {
    return json(res, 400, { error: "Wallet does not match the Discord OAuth session." });
  }
  if (!/^0x[a-f0-9]{40}$/i.test(wallet)) {
    return json(res, 400, { error: "Invalid wallet address." });
  }
  if (!/^SOULSTAMP-VERIFY-[A-F0-9]{12}$/i.test(verificationCode)) {
    return json(res, 400, { error: "Invalid SoulStamp verification code." });
  }
  if (claimedId !== session.user.id) {
    return json(res, 400, { error: "Claimed Discord user does not match the OAuth account." });
  }

  const now = nowSeconds();
  const attestationId = randomBytes(24).toString("hex");
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
  attestations.set(attestationId, attestation);

  json(res, 201, {
    attestation_url: `${PUBLIC_BASE_URL}/api/discord/attestations/${attestationId}`,
    expires_at: attestation.expires_at,
    discord_id: session.user.id,
    claimed_username: claimedUsername,
  });
}

function handleGetAttestation(reqUrl, res) {
  const id = reqUrl.pathname.split("/").pop();
  const attestation = attestations.get(id);
  if (!attestation) return json(res, 404, { error: "Discord attestation not found" });
  json(res, 200, attestation);
}

async function router(req, res) {
  pruneExpired();
  if (req.method === "OPTIONS") return json(res, 204, {});

  const reqUrl = new URL(req.url || "/", PUBLIC_BASE_URL);
  try {
    if (req.method === "GET" && reqUrl.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        public_base_url: PUBLIC_BASE_URL,
        discord_configured: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
      });
    }
    if (req.method === "GET" && reqUrl.pathname === "/api/discord/start") {
      return await handleDiscordStart(reqUrl, res);
    }
    if (req.method === "GET" && reqUrl.pathname === "/api/discord/callback") {
      return await handleDiscordCallback(reqUrl, res);
    }
    if (req.method === "POST" && reqUrl.pathname === "/api/discord/attest") {
      return await handleCreateAttestation(req, res);
    }
    if (req.method === "GET" && reqUrl.pathname.startsWith("/api/discord/attestations/")) {
      return handleGetAttestation(reqUrl, res);
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("[soulstamp-discord]", error);
    if (reqUrl.pathname === "/api/discord/callback") {
      const fallback = isAllowedReturnTo(reqUrl.searchParams.get("return_to") || "")
        ? reqUrl.searchParams.get("return_to")
        : FRONTEND_ORIGIN;
      return redirect(res, appendParams(fallback, { discord_error: error.message || "Discord OAuth failed" }));
    }
    return json(res, 500, { error: error.message || "Unexpected server error" });
  }
}

http.createServer(router).listen(PORT, () => {
  console.log(`[soulstamp-discord] listening on http://localhost:${PORT}`);
  console.log(`[soulstamp-discord] public base: ${PUBLIC_BASE_URL}`);
});
