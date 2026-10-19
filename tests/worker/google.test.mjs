import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import worker from "../../backend/index.js";

const SESSION_SECRET = "s".repeat(32);
const COMMITMENT_SECRET = "g".repeat(32);
const WALLET = "0x1111111111111111111111111111111111111111";
const V4 = "0x2222222222222222222222222222222222222222";
const BASE = {
  DISCORD_CLIENT_ID: "discord-client",
  DISCORD_CLIENT_SECRET: "discord-secret",
  DISCORD_REDIRECT_URI: "https://worker.example/api/discord/callback",
  PUBLIC_BASE_URL: "https://worker.example",
  FRONTEND_ORIGIN: "https://frontend.example",
  BACKEND_SESSION_SECRET: SESSION_SECRET,
  GOOGLE_CLIENT_ID: "google-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GOOGLE_REDIRECT_URI: "https://worker.example/api/google/callback",
  GOOGLE_ACCOUNT_COMMITMENT_SECRET: COMMITMENT_SECRET,
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "soulstamp-test-key";

function b64(value) { return Buffer.from(value).toString("base64url"); }
function jwt(claims) {
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid }));
  const body = b64(JSON.stringify(claims));
  const input = `${header}.${body}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  return `${input}.${signer.sign(privateKey).toString("base64url")}`;
}

function googleStartUrl() {
  return new URL("https://worker.example/api/google/start?wallet=" + WALLET + "&pending_id=AAAAAAAAAAAAAAAAAAAAAAAA&v4_contract=" + V4 + "&return_to=https%3A%2F%2Ffrontend.example%2F&chain_id=61999");
}

function makeFetch({ audience = BASE.GOOGLE_CLIENT_ID, nonce, signatureKey = privateKey, expiresIn = 600, issuedAt } = {}) {
  const original = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const iat = issuedAt ?? now;
  const idToken = (() => {
    const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid }));
    const body = b64(JSON.stringify({
      iss: "https://accounts.google.com",
      aud: audience,
      azp: BASE.GOOGLE_CLIENT_ID,
      exp: iat + expiresIn,
      iat,
      nonce,
      sub: "1234567890",
      email: "private@example.com",
      email_verified: true,
    }));
    const input = `${header}.${body}`;
    const signer = createSign("RSA-SHA256");
    signer.update(input);
    return `${input}.${signer.sign(signatureKey).toString("base64url")}`;
  })();
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const body = String(init.body || "");
      assert.match(body, /code_verifier=/, "PKCE verifier must be sent to Google");
      return new Response(JSON.stringify({ id_token: idToken, access_token: "never-returned" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://accounts.google.com/.well-known/openid-configuration") {
      return new Response(JSON.stringify({ jwks_uri: "https://www.googleapis.com/oauth2/v3/certs" }), { status: 200 });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    return original(input, init);
  };
  return () => { globalThis.fetch = original; };
}

test("Google start requires real Worker secrets and emits OIDC + PKCE state", async () => {
  const response = await worker.fetch(new Request(googleStartUrl()), { ...BASE, GOOGLE_ACCOUNT_COMMITMENT_SECRET: undefined });
  assert.equal(response.status, 500);
  assert.match(await response.text(), /GOOGLE_ACCOUNT_COMMITMENT_SECRET/);

  const configured = await worker.fetch(new Request(googleStartUrl()), BASE);
  assert.equal(configured.status, 302);
  const location = new URL(configured.headers.get("location"));
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("scope"), "openid email profile");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("code_challenge"));
  assert.ok(location.searchParams.get("state"));
});

test("Google callback verifies signature, issuer, audience, nonce and email_verified without leaking claims", async () => {
  const start = await worker.fetch(new Request(googleStartUrl()), BASE);
  const authorize = new URL(start.headers.get("location"));
  const cleanup = makeFetch({ nonce: authorize.searchParams.get("nonce") });
  try {
    const callback = new URL("https://worker.example/api/google/callback");
    callback.searchParams.set("state", authorize.searchParams.get("state"));
    callback.searchParams.set("code", "real-one-use-code");
    const response = await worker.fetch(new Request(callback), BASE);
    assert.equal(response.status, 302);
    const redirect = new URL(response.headers.get("location"));
    assert.equal(redirect.searchParams.get("google_status"), "ready");
    const attestationUrl = redirect.searchParams.get("google_attestation_url");
    assert.match(attestationUrl, /^https:\/\/worker\.example\/api\/google\/attestations\//);
    const evidenceResponse = await worker.fetch(new Request(attestationUrl), BASE);
    assert.equal(evidenceResponse.status, 200);
    const evidence = await evidenceResponse.json();
    assert.equal(evidence.platform, "google");
    assert.equal(evidence.wallet, WALLET);
    assert.equal(evidence.v4_contract, V4.toLowerCase());
    assert.match(evidence.account_commitment, /^v1:[0-9a-f]{64}$/);
    assert.equal("sub" in evidence, false);
    assert.equal("email" in evidence, false);
    assert.equal("access_token" in evidence, false);
  } finally { cleanup(); }
});

test("Google callback fails closed on wrong audience and forged signature", async () => {
  const start = await worker.fetch(new Request(googleStartUrl()), BASE);
  const authorize = new URL(start.headers.get("location"));
  const cleanup = makeFetch({ nonce: authorize.searchParams.get("nonce"), audience: "attacker.apps.googleusercontent.com" });
  try {
    const callback = new URL("https://worker.example/api/google/callback");
    callback.searchParams.set("state", authorize.searchParams.get("state"));
    callback.searchParams.set("code", "bad-code");
    const response = await worker.fetch(new Request(callback), BASE);
    assert.equal(response.status, 302);
    assert.match(new URL(response.headers.get("location")).searchParams.get("google_error"), /audience/);
  } finally { cleanup(); }
});

test("Google callback accepts a normal approximately one-hour ID token", async () => {
  const start = await worker.fetch(new Request(googleStartUrl()), BASE);
  const authorize = new URL(start.headers.get("location"));
  const cleanup = makeFetch({ nonce: authorize.searchParams.get("nonce"), expiresIn: 3600 });
  try {
    const callback = new URL("https://worker.example/api/google/callback");
    callback.searchParams.set("state", authorize.searchParams.get("state"));
    callback.searchParams.set("code", "one-hour-code");
    const response = await worker.fetch(new Request(callback), BASE);
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).searchParams.get("google_status"), "ready");
  } finally { cleanup(); }
});

test("Google callback rejects an excessively long-lived ID token", async () => {
  const start = await worker.fetch(new Request(googleStartUrl()), BASE);
  const authorize = new URL(start.headers.get("location"));
  const cleanup = makeFetch({ nonce: authorize.searchParams.get("nonce"), expiresIn: 60 * 60 + 6 * 60 });
  try {
    const callback = new URL("https://worker.example/api/google/callback");
    callback.searchParams.set("state", authorize.searchParams.get("state"));
    callback.searchParams.set("code", "too-long-code");
    const response = await worker.fetch(new Request(callback), BASE);
    assert.equal(response.status, 302);
    assert.match(new URL(response.headers.get("location")).searchParams.get("google_error"), /too long-lived|lifetime/);
  } finally { cleanup(); }
});
