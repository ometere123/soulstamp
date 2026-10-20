import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverPassport } from "../../frontend/src/lib/passportDiscovery";

const wallet = "0xFd69A5D0b8330dC86e266304B3D1ABE3F57b9D09";
const uid = "0x65843ca97b6f8133713feeff548173b64cb5c7bf98839e68f77c701fb6d17813";
const schema = "0x81d8758ccd97bbeea7642df29001f6046a676b3c24f808c4297db5ee36838dd8";
const attester = "0x8b1a76795e3cbadd79c5410d2c4d4827d9c1503a";

afterEach(() => vi.unstubAllGlobals());

function response(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    wallet: wallet.toLowerCase(),
    chain_id: 11155420,
    approved_schema_uid: schema,
    approved_attester: attester,
    approved_scorer_id: 335,
    passport_api: { available: true, scorer_id: "335", matches_approved_scorer: true, score: 44.698, passing_score: true, stamp_count: 2 },
    eas_indexer: { endpoint: "https://optimism-sepolia.easscan.org/graphql", candidates: [] },
    candidate: null,
    candidate_count: 0,
    authority: "candidate_only_until_direct_eas_validation",
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("automatic Passport discovery", () => {
  it("binds a discovery candidate to the connected wallet and keeps API results informational", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      candidate: { attestation_uid: uid, recipient: wallet.toLowerCase(), schema_uid: schema, attester, time: 1792415168, expiration_time: 1800191157, revocation_time: 0, revocable: true },
      candidate_count: 1,
    })));
    const result = await discoverPassport(wallet);
    expect(result.candidate?.attestation_uid).toBe(uid);
    expect(result.passport_api.score).toBe(44.698);
    expect(result.authority).toBe("candidate_only_until_direct_eas_validation");
  });

  it("rejects a Worker response for another wallet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ wallet: "0x2222222222222222222222222222222222222222" })));
    await expect(discoverPassport(wallet)).rejects.toThrow(/different wallet/i);
  });

  it("does not accept a candidate with the wrong schema or attester", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      candidate: { attestation_uid: uid, recipient: wallet.toLowerCase(), schema_uid: "0x" + "11".repeat(32), attester: "0x" + "22".repeat(20), time: 1, expiration_time: 2, revocation_time: 0, revocable: true },
      candidate_count: 1,
    })));
    const result = await discoverPassport(wallet);
    expect(result.candidate).toBeNull();
  });

  it("surfaces server rate limiting without retrying or inventing an attestation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "rate limit", code: "RATE_LIMITED" }), { status: 429 })));
    await expect(discoverPassport(wallet)).rejects.toThrow(/rate limit/i);
  });
});
