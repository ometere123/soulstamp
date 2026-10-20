import { afterEach, describe, expect, it, vi } from "vitest";
import realFixture from "../fixtures/human-passport-eas-real.json";
import {
  HUMAN_PASSPORT_DECODER,
  HUMAN_PASSPORT_EAS,
  HUMAN_PASSPORT_PERMITTED_ATTESTER,
  HUMAN_PASSPORT_SCHEMA_REGISTRY,
  HUMAN_PASSPORT_THRESHOLD_RAW,
  HUMAN_PASSPORT_UNIFIED_RESOLVER,
  HUMAN_PASSPORT_UNIFIED_SCHEMA,
  HUMAN_PASSPORT_UNIFIED_SCHEMA_UID,
  readHumanPassport,
  readUnifiedHumanPassport,
} from "../../frontend/src/lib/humanPassport";

const WALLET = "0x1111111111111111111111111111111111111111";
const BLOCK = "0x64";
const HASH = `0x${"ab".repeat(32)}`;
const UID = `0x${"65".repeat(32)}`;
const ATTESTATION_TIME = 1_792_415_168;
const EXPIRATION_TIME = 1_800_191_157;

function word(value: bigint | number | string) {
  const hex = typeof value === "string" && value.startsWith("0x") ? value.slice(2) : BigInt(value).toString(16);
  return hex.padStart(64, "0");
}

function bytesTail(value: string) {
  const hex = Buffer.from(value, "utf8").toString("hex");
  return word(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
}

function encodeUnifiedData(score = 446980, scorerId = 335, threshold = 200000) {
  const stamps = ["Google", "Discord"].map((provider, index) => `${word(64)}${word(index === 0 ? 100 : 90)}${bytesTail(provider)}`);
  let offset = stamps.length * 32;
  const offsets = stamps.map((element) => { const current = offset; offset += element.length / 2; return word(current); });
  return `0x${[
    word(1), word(4), word(scorerId), word(score), word(threshold), word(192),
    word(stamps.length), ...offsets, ...stamps,
  ].join("")}`;
}

function encodeSchemaRecord(schema = HUMAN_PASSPORT_UNIFIED_SCHEMA, resolver = HUMAN_PASSPORT_UNIFIED_RESOLVER) {
  return `0x${[word(32), HUMAN_PASSPORT_UNIFIED_SCHEMA_UID.slice(2), word(`0x${resolver.slice(2)}`), word(1), word(128), bytesTail(schema)].join("")}`;
}

function encodeAttestation({ recipient = WALLET, schema = HUMAN_PASSPORT_UNIFIED_SCHEMA_UID, attester = HUMAN_PASSPORT_PERMITTED_ATTESTER, data = encodeUnifiedData(), expiration = EXPIRATION_TIME, revocation = 0 } = {}) {
  const payload = [
    word(32), UID.slice(2), schema.slice(2), word(ATTESTATION_TIME), word(expiration), word(revocation), word(0),
    word(`0x${recipient.slice(2)}`), word(`0x${attester.slice(2)}`), word(1), word(320),
    word((data.length - 2) / 2), data.slice(2).padEnd(Math.ceil((data.length - 2) / 64) * 64, "0"),
  ];
  return `0x${payload.join("")}`;
}

function mockUnifiedRpc(overrides: { recipient?: string; schema?: string; attester?: string; data?: string; expiration?: number; revocation?: number; schemaRecord?: string } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    let result: unknown;
    if (body.method === "eth_chainId") result = "0xaa37dc";
    else if (body.method === "eth_blockNumber") result = BLOCK;
    else if (body.method === "eth_getBlockByNumber") result = { number: BLOCK, hash: HASH, timestamp: `0x${ATTESTATION_TIME.toString(16)}` };
    else if (body.method === "eth_getCode") result = "0x6001600155";
    else if (body.method === "eth_call" && String(body.params?.[0]?.to || "").toLowerCase() === HUMAN_PASSPORT_EAS.toLowerCase()) result = encodeAttestation(overrides);
    else if (body.method === "eth_call" && String(body.params?.[0]?.to || "").toLowerCase() === HUMAN_PASSPORT_SCHEMA_REGISTRY.toLowerCase()) result = overrides.schemaRecord || encodeSchemaRecord();
    else result = "0x";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
}

function mockCapturedUnifiedRpc() {
  const blockNumber = Number(realFixture.block.number);
  const blockTag = `0x${blockNumber.toString(16)}`;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    let result: unknown;
    if (body.method === "eth_chainId") result = "0xaa37dc";
    else if (body.method === "eth_getBlockByNumber") result = { number: blockTag, hash: realFixture.block.hash, timestamp: `0x${Number(realFixture.block.timestamp).toString(16)}` };
    else if (body.method === "eth_getCode") result = "0x6001600155";
    else if (body.method === "eth_call" && String(body.params?.[0]?.to || "").toLowerCase() === HUMAN_PASSPORT_EAS.toLowerCase()) result = realFixture.eas.raw;
    else if (body.method === "eth_call" && String(body.params?.[0]?.to || "").toLowerCase() === HUMAN_PASSPORT_SCHEMA_REGISTRY.toLowerCase()) result = realFixture.schemaRegistry.raw;
    else result = "0x";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
}

function mockRpc(rawScore: number) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const results: Record<string, unknown> = {
      eth_chainId: "0xaa37dc",
      eth_blockNumber: BLOCK,
      eth_getBlockByNumber: { number: BLOCK, hash: HASH, timestamp: "0x68f00000" },
      eth_getCode: "0x6001600155",
      eth_call: `0x${BigInt(rawScore).toString(16).padStart(64, "0")}`,
    };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: results[body.method] }), { status: 200 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Human Passport pinned decoder adapter", () => {
  it("uses the documented raw-score scaling and passes exactly at raw 200000", async () => {
    mockRpc(HUMAN_PASSPORT_THRESHOLD_RAW);
    const evidence = await readHumanPassport(WALLET, 100);
    expect(evidence.decoder).toBe(HUMAN_PASSPORT_DECODER);
    expect(evidence.rawScore).toBe(200000);
    expect(evidence.score).toBe(20);
    expect(evidence.thresholdMet).toBe(true);
  });

  it("rejects raw 199999 without rounding up", async () => {
    mockRpc(199999);
    const evidence = await readHumanPassport(WALLET, 100);
    expect(evidence.score).toBe(19.9999);
    expect(evidence.thresholdMet).toBe(false);
  });

  it("fails closed when the configured decoder has no code", async () => {
    const mock = mockRpc(200001);
    mock.mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const result = body.method === "eth_getCode" ? "0x" : body.method === "eth_chainId" ? "0xaa37dc" : body.method === "eth_blockNumber" ? BLOCK : body.method === "eth_getBlockByNumber" ? { number: BLOCK, hash: HASH, timestamp: "0x68f00000" } : `0x${BigInt(200001).toString(16).padStart(64, "0")}`;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
    });
    await expect(readHumanPassport(WALLET, 100)).rejects.toThrow("has no code");
  });
});

describe("Human Passport unified EAS adapter", () => {
  it("decodes the captured real EAS and Schema Registry responses at the mint block", async () => {
    mockCapturedUnifiedRpc();
    const evidence = await readUnifiedHumanPassport(realFixture.wallet, realFixture.attestationUid, Number(realFixture.block.number));
    expect(evidence.wallet).toBe(realFixture.wallet.toLowerCase());
    expect(evidence.blockHash).toBe(realFixture.block.hash);
    expect(evidence.attestationUid).toBe(realFixture.eas.decoded.uid);
    expect(evidence.schemaUid).toBe(realFixture.schemaRegistry.decoded.uid);
    expect(evidence.resolver).toBe(realFixture.schemaRegistry.decoded.resolver.toLowerCase());
    expect(evidence.attester).toBe(realFixture.eas.decoded.attester.toLowerCase());
    expect(evidence.expirationTime).toBe(Number(realFixture.eas.decoded.expirationTime));
    expect(evidence.revocationTime).toBe(0);
    expect(evidence.scorerId).toBe(335);
    expect(evidence.rawScore).toBe(446980);
    expect(evidence.thresholdRaw).toBe(200000);
    expect(evidence.score?.toFixed(4)).toBe("44.6980");
    expect(evidence.thresholdMet).toBe(true);
  });

  it("decodes the real unified schema, four-decimal score and bounded stamps", async () => {
    mockUnifiedRpc();
    const evidence = await readUnifiedHumanPassport(WALLET, UID, 100);
    expect(evidence.source).toBe("eas-unified");
    expect(evidence.rawScore).toBe(446980);
    expect(evidence.score).toBe(44.698);
    expect(evidence.score.toFixed(4)).toBe("44.6980");
    expect(evidence.scorerId).toBe(335);
    expect(evidence.thresholdMet).toBe(true);
    expect(evidence.attestationUid).toBe(UID);
    expect(evidence.stamps?.map((stamp) => stamp.provider)).toEqual(["Google", "Discord"]);
  });

  it.each([
    ["recipient", { recipient: "0x2222222222222222222222222222222222222222" }],
    ["schema", { schema: `0x${"99".repeat(32)}` }],
    ["attester", { attester: "0x2222222222222222222222222222222222222222" }],
    ["scorer", { data: encodeUnifiedData(446980, 334) }],
    ["revocation", { revocation: 1 }],
    ["expiry", { expiration: ATTESTATION_TIME - 1 }],
  ] as const)("rejects an authenticated-record mismatch: %s", async (_label, overrides) => {
    mockUnifiedRpc(overrides);
    await expect(readUnifiedHumanPassport(WALLET, UID, 100)).rejects.toThrow();
  });

  it("rejects malformed dynamic ABI data instead of trusting a score field", async () => {
    mockUnifiedRpc({ data: "0x1234" });
    await expect(readUnifiedHumanPassport(WALLET, UID, 100)).rejects.toThrow(/truncated|offset|ABI/i);
  });

  it("rejects a schema registry resolver that is not the approved unified resolver", async () => {
    mockUnifiedRpc({ schemaRecord: encodeSchemaRecord(HUMAN_PASSPORT_UNIFIED_SCHEMA, "0x2222222222222222222222222222222222222222") });
    await expect(readUnifiedHumanPassport(WALLET, UID, 100)).rejects.toThrow(/schema registry|resolver/i);
  });
});
