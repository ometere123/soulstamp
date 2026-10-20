import assert from "node:assert/strict";
import test from "node:test";
import worker from "../../backend/index.js";

const BASE = {
  PUBLIC_BASE_URL: "https://worker.example",
  FRONTEND_ORIGIN: "https://frontend.example",
  PASSPORT_API_KEY: "server-only-passport-key",
  PASSPORT_SCORER_ID: "335",
  PASSPORT_GRAPHQL_URL: "https://optimism-sepolia.easscan.org/graphql",
};
const WALLET = "0xFd69A5D0b8330dC86e266304B3D1ABE3F57b9D09";
const SCHEMA = "0x81d8758ccd97bbeea7642df29001f6046a676b3c24f808c4297db5ee36838dd8";
const ATTESTER = "0x8b1a76795e3cbadd79c5410d2c4d4827d9c1503a";
const UID = "0x65843ca97b6f8133713feeff548173b64cb5c7bf98839e68f77c701fb6d17813";

function mockUpstreams({ indexer = true, fallbackIndexer = false, api = true, scorer = BASE.PASSPORT_SCORER_ID } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://api.passport.xyz/")) {
      if (!api) throw new Error("Passport API unavailable");
      assert.equal(new Headers(init.headers).get("X-API-Key"), BASE.PASSPORT_API_KEY);
      assert.match(url, new RegExp(`/stamps/${scorer}/score/`));
      return new Response(JSON.stringify({ score: "44.6980", passing_score: true, stamps: { github: {}, discord: {} }, last_score_timestamp: "2026-10-20T12:00:00Z" }), { status: 200 });
    }
    if (url === BASE.PASSPORT_GRAPHQL_URL) {
      if (!indexer) return new Response(JSON.stringify({ errors: [{ message: "indexer down" }] }), { status: 503 });
      const body = JSON.parse(String(init.body));
      assert.match(body.query, /schemaId/);
      assert.equal(body.variables.recipient, WALLET);
      return new Response(JSON.stringify({ data: { attestations: [{ id: UID, attester: ATTESTER, recipient: WALLET.toLowerCase(), schemaId: SCHEMA, revocable: true, revocationTime: 0, expirationTime: 1800191157, time: 1792415168 }] } }), { status: 200 });
    }
    if (url === "https://optimism-sepolia-bedrock.easscan.org/graphql") {
      if (!fallbackIndexer) return new Response(JSON.stringify({ errors: [{ message: "fallback unavailable" }] }), { status: 503 });
      return new Response(JSON.stringify({ data: { attestations: [{ id: UID, attester: ATTESTER, recipient: WALLET.toLowerCase(), schemaId: SCHEMA, revocable: true, revocationTime: 0, expirationTime: 1800191157, time: 1792415168 }] } }), { status: 200 });
    }
    throw new Error(`unexpected upstream ${url}`);
  };
  return () => { globalThis.fetch = original; };
}

test("Passport discovery uses server credentials and returns a candidate-only result", async () => {
  const restore = mockUpstreams();
  try {
    const response = await worker.fetch(new Request(`https://worker.example/api/passport/discover?wallet=${WALLET}`), BASE);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.wallet, WALLET.toLowerCase());
    assert.equal(body.passport_api.score, 44.698);
    assert.equal(body.passport_api.stamp_count, 2);
    assert.equal(body.passport_api.matches_approved_scorer, true);
    assert.equal(body.candidate.attestation_uid, UID);
    assert.equal(body.authority, "candidate_only_until_direct_eas_validation");
    assert.equal(JSON.stringify(body).includes(BASE.PASSPORT_API_KEY), false);
  } finally { restore(); }
});

test("Passport discovery canonicalizes lowercase wallets before the case-sensitive indexer query", async () => {
  const restore = mockUpstreams();
  try {
    const response = await worker.fetch(new Request(`https://worker.example/api/passport/discover?wallet=${WALLET.toLowerCase()}`), BASE);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.wallet, WALLET.toLowerCase());
    assert.equal(body.candidate.attestation_uid, UID);
  } finally { restore(); }
});

test("Passport discovery keeps API information when the indexer is unavailable", async () => {
  const restore = mockUpstreams({ indexer: false });
  try {
    const response = await worker.fetch(new Request(`https://worker.example/api/passport/discover?wallet=${WALLET}`), BASE);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.passport_api.available, true);
    assert.equal(body.candidate, null);
    assert.equal(body.eas_indexer.error_code, "PASSPORT_INDEXER_HTTP_503");
  } finally { restore(); }
});

test("Passport discovery keeps EAS discovery when the API is unavailable or unconfigured", async () => {
  const restore = mockUpstreams({ api: false });
  try {
    const apiDown = await worker.fetch(new Request(`https://worker.example/api/passport/discover?wallet=${WALLET}`), BASE);
    assert.equal(apiDown.status, 200);
    const apiDownBody = await apiDown.json();
    assert.equal(apiDownBody.candidate.attestation_uid, UID);
    assert.equal(apiDownBody.passport_api.available, false);
    assert.equal(apiDownBody.passport_api.error_code, "PASSPORT_API_UNAVAILABLE");

    const unconfigured = await worker.fetch(new Request(`https://worker.example/api/passport/discover?wallet=${WALLET}`), { ...BASE, PASSPORT_API_KEY: undefined });
    assert.equal(unconfigured.status, 200);
    const unconfiguredBody = await unconfigured.json();
    assert.equal(unconfiguredBody.candidate.attestation_uid, UID);
    assert.equal(unconfiguredBody.passport_api.error_code, "PASSPORT_API_NOT_CONFIGURED");
  } finally { restore(); }
});

test("Passport discovery uses the bounded secondary indexer when the primary is unavailable", async () => {
  const restore = mockUpstreams({ indexer: false, fallbackIndexer: true });
  try {
    const response = await worker.fetch(new Request(`https://worker.example/api/passport/discover?wallet=${WALLET}`), BASE);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.candidate.attestation_uid, UID);
    assert.match(body.eas_indexer.endpoint, /bedrock/);
  } finally { restore(); }
});

test("Passport discovery rejects malformed wallets", async () => {
  const malformed = await worker.fetch(new Request("https://worker.example/api/passport/discover?wallet=not-a-wallet"), BASE);
  assert.equal(malformed.status, 500);
  assert.match(await malformed.text(), /wallet address/i);
});

test("Passport discovery applies a bounded per-wallet rate limit", async () => {
  const wallet = "0x0000000000000000000000000000000000000042";
  const restore = mockUpstreams();
  try {
    let last;
    for (let index = 0; index < 13; index += 1) last = await worker.fetch(new Request(`https://worker.example/api/passport/discover?wallet=${wallet}`), BASE);
    assert.equal(last.status, 429);
    assert.match(await last.text(), /rate limit/i);
  } finally { restore(); }
});
