import { afterEach, describe, expect, it, vi } from "vitest";
import { HUMAN_PASSPORT_DECODER, HUMAN_PASSPORT_THRESHOLD_RAW, readHumanPassport } from "../../frontend/src/lib/humanPassport";

const WALLET = "0x1111111111111111111111111111111111111111";
const BLOCK = "0x64";
const HASH = `0x${"ab".repeat(32)}`;

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
