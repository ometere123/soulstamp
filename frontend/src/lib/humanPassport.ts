export const HUMAN_PASSPORT_CHAIN_ID = 11_155_420;
export const HUMAN_PASSPORT_DECODER = (import.meta.env.VITE_HUMAN_PASSPORT_DECODER_ADDRESS || "0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56").toLowerCase();
export const HUMAN_PASSPORT_RPC_URL = (import.meta.env.VITE_HUMAN_PASSPORT_RPC_URL || "https://sepolia.optimism.io").trim();
export const HUMAN_PASSPORT_THRESHOLD_RAW = 200_000;
export const HUMAN_PASSPORT_THRESHOLD_DISPLAY = 20;
export const HUMAN_PASSPORT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type RpcResponse<T> = { result?: T; error?: { message?: string } };

function requireAddress(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("Human Passport subject wallet is malformed.");
  return value as `0x${string}`;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  if (!HUMAN_PASSPORT_RPC_URL) throw new Error("Human Passport RPC is not configured for this frontend.");
  const response = await fetch(HUMAN_PASSPORT_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Human Passport RPC HTTP ${response.status}.`);
  const body = await response.json() as RpcResponse<T>;
  if (body.error) throw new Error(body.error.message || "Human Passport RPC error.");
  if (body.result === undefined) throw new Error("Human Passport RPC returned no result.");
  return body.result;
}

function hexNumber(value: string, label: string): number {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`${label} is malformed.`);
  return Number(BigInt(value));
}

function addressWord(wallet: string): string {
  return requireAddress(wallet).slice(2).toLowerCase().padStart(64, "0");
}

export type HumanPassportEvidence = {
  wallet: string;
  chainId: number;
  decoder: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  rawScore: number;
  score: number;
  thresholdRaw: number;
  threshold: number;
  thresholdMet: boolean;
  observedAt: number;
};

export async function readHumanPassport(wallet: string, blockNumber?: number): Promise<HumanPassportEvidence> {
  const subject = requireAddress(wallet).toLowerCase();
  const chainHex = await rpc<string>("eth_chainId", []);
  const chainId = hexNumber(chainHex, "Human Passport chain ID");
  if (chainId !== HUMAN_PASSPORT_CHAIN_ID) throw new Error(`Human Passport RPC is on chain ${chainId}; Optimism Sepolia 11155420 is required.`);
  const block = blockNumber ?? hexNumber(await rpc<string>("eth_blockNumber", []), "Human Passport block number");
  if (!Number.isSafeInteger(block) || block <= 0) throw new Error("Human Passport block number is invalid.");
  const blockData = await rpc<{ number?: string; hash?: string; timestamp?: string }>("eth_getBlockByNumber", [`0x${block.toString(16)}`, false]);
  if (!blockData || hexNumber(String(blockData.number || "0x0"), "Human Passport block number") !== block) throw new Error("Human Passport block changed or was unavailable.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(blockData.hash || ""))) throw new Error("Human Passport block hash is malformed.");
  const decoderCode = await rpc<string>("eth_getCode", [HUMAN_PASSPORT_DECODER, `0x${block.toString(16)}`]);
  if (!/^0x[0-9a-fA-F]+$/.test(decoderCode) || decoderCode.length <= 2) throw new Error("Human Passport decoder has no code at the pinned block.");
  const raw = await rpc<string>("eth_call", [
    { to: HUMAN_PASSPORT_DECODER, data: `0xd47875d0${addressWord(subject)}` },
    `0x${block.toString(16)}`,
  ]);
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error("Human Passport getScore returned an invalid ABI word.");
  const rawScore = Number(BigInt(raw));
  const blockTimestamp = hexNumber(String(blockData.timestamp || "0x0"), "Human Passport block timestamp");
  return {
    wallet: subject,
    chainId,
    decoder: HUMAN_PASSPORT_DECODER,
    blockNumber: block,
    blockHash: String(blockData.hash).toLowerCase(),
    blockTimestamp,
    rawScore,
    score: rawScore / 10_000,
    thresholdRaw: HUMAN_PASSPORT_THRESHOLD_RAW,
    threshold: HUMAN_PASSPORT_THRESHOLD_DISPLAY,
    thresholdMet: rawScore >= HUMAN_PASSPORT_THRESHOLD_RAW,
    observedAt: Math.floor(Date.now() / 1000),
  };
}

export function humanPassportDocumentationUrl(): string {
  return "https://docs.passport.human.tech/building-with-passport/stamps/smart-contracts/quick-start-guide";
}

export function humanPassportAppUrl(): string {
  return "https://app.passport.xyz";
}
