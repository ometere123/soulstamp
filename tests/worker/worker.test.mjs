import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import worker from "../../backend/index.js";

const baseEnv = {
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_REDIRECT_URI: "https://worker.example/api/discord/callback",
  PUBLIC_BASE_URL: "https://worker.example",
  FRONTEND_ORIGIN: "https://frontend.example",
};
const SESSION_SECRET = "s".repeat(32);
const OWNER_WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signedToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function discordSession({ wallet = OWNER_WALLET, exp = Math.floor(Date.now() / 1000) + 600 } = {}) {
  return signedToken({
    purpose: "discord_session",
    wallet: wallet.toLowerCase(),
    user: {
      id: "123456789012345678",
      username: "alice",
      global_name: "Alice",
      verified: true,
    },
    exp,
  });
}

function attestationUrl(token) {
  return `https://worker.example/api/discord/attestations/${token}`;
}

function attestationRequest({ session_id = discordSession(), wallet = OWNER_WALLET, verification_code = "SOULSTAMP-CHALLENGE-AAAAAAAAAAAA", claimed_username = "Alice#123456789012345678", pending_id = "AAAAAAAAAAAAAAAAAAAAAAAA" } = {}) {
  return new Request("https://worker.example/api/discord/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, wallet, verification_code, claimed_username, pending_id }),
  });
}

test("OAuth routes fail closed when the Worker signing secret is absent", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/api/discord/start?wallet=0x1111111111111111111111111111111111111111"),
    baseEnv,
  );
  assert.equal(response.status, 500);
  assert.match(await response.text(), /BACKEND_SESSION_SECRET/);
});

test("OAuth state is signed when a sufficiently strong secret is configured", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/api/discord/start?wallet=0x1111111111111111111111111111111111111111&return_to=https%3A%2F%2Ffrontend.example%2F"),
    { ...baseEnv, BACKEND_SESSION_SECRET: "s".repeat(32) },
  );
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /^https:\/\/discord\.com\/oauth2\/authorize/);
});

test("attestation binds the OAuth Discord identity, wallet, code, and pending ID", async () => {
  const env = { ...baseEnv, BACKEND_SESSION_SECRET: SESSION_SECRET };
  const response = await worker.fetch(attestationRequest(), env);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.attestation_url, /^https:\/\/worker\.example\/api\/discord\/attestations\//);
  assert.equal(body.wallet, OWNER_WALLET);
  assert.equal(body.verification_code, "SOULSTAMP-CHALLENGE-AAAAAAAAAAAA");
  assert.equal(body.pending_id, "AAAAAAAAAAAAAAAAAAAAAAAA");

  const evidence = await worker.fetch(new Request(body.attestation_url), env);
  assert.equal(evidence.status, 200);
  const evidenceBody = await evidence.json();
  assert.equal(evidenceBody.wallet, OWNER_WALLET);
  assert.equal(evidenceBody.discord_user_id, "123456789012345678");
  assert.equal(evidenceBody.pending_id, "AAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(evidenceBody.verification_code, "SOULSTAMP-CHALLENGE-AAAAAAAAAAAA");
  assert.ok(evidenceBody.issued_at <= evidenceBody.expires_at);
});

test("attestation endpoint rejects a wallet mismatch and expired OAuth session", async () => {
  const env = { ...baseEnv, BACKEND_SESSION_SECRET: SESSION_SECRET };
  const mismatch = await worker.fetch(attestationRequest({ wallet: OTHER_WALLET }), env);
  assert.equal(mismatch.status, 400);
  assert.match(await mismatch.text(), /Wallet does not match/);

  const expired = await worker.fetch(
    attestationRequest({ session_id: discordSession({ exp: Math.floor(Date.now() / 1000) - 1 }) }),
    env,
  );
  assert.equal(expired.status, 500);
  assert.match(await expired.text(), /Signed token expired/);
});

test("tampered and expired signed attestation URLs fail closed", async () => {
  const env = { ...baseEnv, BACKEND_SESSION_SECRET: SESSION_SECRET };
  const valid = signedToken({
    purpose: "discord_attestation",
    attestation: { expires_at: Math.floor(Date.now() / 1000) + 300 },
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const tampered = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
  const tamperedResponse = await worker.fetch(new Request(attestationUrl(tampered)), env);
  assert.equal(tamperedResponse.status, 500);
  assert.match(await tamperedResponse.text(), /Invalid signed token signature/);

  const expired = signedToken({
    purpose: "discord_attestation",
    attestation: { expires_at: Math.floor(Date.now() / 1000) - 1 },
    exp: Math.floor(Date.now() / 1000) - 1,
  });
  const expiredResponse = await worker.fetch(new Request(attestationUrl(expired)), env);
  assert.equal(expiredResponse.status, 500);
  assert.match(await expiredResponse.text(), /Signed token expired/);
});

test("repeated attestation requests issue distinct fresh signed evidence", async () => {
  const env = { ...baseEnv, BACKEND_SESSION_SECRET: SESSION_SECRET };
  const first = await worker.fetch(attestationRequest(), env);
  const second = await worker.fetch(attestationRequest(), env);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.notEqual(firstBody.attestation_url, secondBody.attestation_url);

  const firstEvidence = await (await worker.fetch(new Request(firstBody.attestation_url), env)).json();
  const secondEvidence = await (await worker.fetch(new Request(secondBody.attestation_url), env)).json();
  assert.notEqual(firstEvidence.nonce, secondEvidence.nonce);
  assert.notEqual(firstEvidence.attestation_id, secondEvidence.attestation_id);
});
