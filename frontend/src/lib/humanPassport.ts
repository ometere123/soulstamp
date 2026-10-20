export const HUMAN_PASSPORT_CHAIN_ID = 11_155_420;
export const HUMAN_PASSPORT_DECODER = (import.meta.env.VITE_HUMAN_PASSPORT_DECODER_ADDRESS || "0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56").toLowerCase();
export const HUMAN_PASSPORT_RPC_URL = (import.meta.env.VITE_HUMAN_PASSPORT_RPC_URL || "https://sepolia.optimism.io").trim();
export const HUMAN_PASSPORT_EAS = "0x4200000000000000000000000000000000000021";
export const HUMAN_PASSPORT_SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020";
export const HUMAN_PASSPORT_UNIFIED_SCHEMA_UID = "0x81d8758ccd97bbeea7642df29001f6046a676b3c24f808c4297db5ee36838dd8";
export const HUMAN_PASSPORT_UNIFIED_SCHEMA = "bool passing_score, uint8 score_decimals, uint128 scorer_id, uint32 score, uint32 threshold, tuple(string provider, uint256 score)[] stamps";
export const HUMAN_PASSPORT_UNIFIED_RESOLVER = "0xa2c832b63a20c06ccc2ca31c12b8248452729a4d";
export const HUMAN_PASSPORT_PERMITTED_ATTESTER = "0x8b1a76795e3cbadd79c5410d2c4d4827d9c1503a";
export const HUMAN_PASSPORT_APPROVED_SCORER_ID = 335;
export const HUMAN_PASSPORT_THRESHOLD_RAW = 200_000;
export const HUMAN_PASSPORT_THRESHOLD_DISPLAY = 20;
export const HUMAN_PASSPORT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type RpcResponse<T> = { result?: T; error?: { message?: string } };

function requireAddress(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("Human Passport subject wallet is malformed.");
  return value as `0x${string}`;
}

function requireHash(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is malformed.`);
  return value.toLowerCase() as `0x${string}`;
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
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the safe integer range.`);
  return result;
}

function addressWord(wallet: string): string {
  return requireAddress(wallet).slice(2).toLowerCase().padStart(64, "0");
}

function hexBody(value: string, label: string): string {
  const clean = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]*$/.test(clean) || ((clean.length - 2) % 2) !== 0) throw new Error(`${label} is not valid hex.`);
  return clean.slice(2);
}

function word(body: string, byteOffset: number, label: string): string {
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset % 32 !== 0) throw new Error(`${label} offset is malformed.`);
  const start = byteOffset * 2;
  if (start + 64 > body.length) throw new Error(`${label} ABI word is truncated.`);
  return body.slice(start, start + 64);
}

function uint(body: string, byteOffset: number, label: string): number {
  const result = Number(BigInt(`0x${word(body, byteOffset, label)}`));
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the safe integer range.`);
  return result;
}

function addressFromWord(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/.test(value) || !/^0{24}[0-9a-f]{40}$/.test(value)) throw new Error(`${label} address is malformed.`);
  return `0x${value.slice(24)}`;
}

function utf8At(body: string, byteOffset: number, label: string): { value: string; end: number } {
  const length = uint(body, byteOffset, `${label} length`);
  const start = byteOffset + 32;
  const end = start + length;
  const paddedEnd = start + Math.ceil(length / 32) * 32;
  if (paddedEnd * 2 > body.length) throw new Error(`${label} is truncated.`);
  try {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = Number.parseInt(body.slice((start + i) * 2, (start + i + 1) * 2), 16);
    return { value: new TextDecoder("utf-8", { fatal: true }).decode(bytes), end: paddedEnd };
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function codeAt(block: number, address: string): Promise<string> {
  return rpc<string>("eth_getCode", [address, `0x${block.toString(16)}`]);
}

type EasAttestation = {
  uid: string;
  schema: string;
  time: number;
  expirationTime: number;
  revocationTime: number;
  revocable: boolean;
  refUid: string;
  recipient: string;
  attester: string;
  data: string;
};

function decodeEasAttestation(raw: string): EasAttestation {
  const body = hexBody(raw, "Human Passport EAS attestation");
  if (body.length < 10 * 64) throw new Error("Human Passport EAS attestation is truncated.");
  const dataOffset = uint(body, 9 * 32, "EAS data");
  const dataLength = uint(body, dataOffset, "EAS data");
  const dataStart = dataOffset + 32;
  const dataEnd = dataStart + dataLength;
  const paddedEnd = dataStart + Math.ceil(dataLength / 32) * 32;
  if (paddedEnd * 2 !== body.length) throw new Error("Human Passport EAS attestation has trailing or missing ABI data.");
  const revocable = uint(body, 5 * 32, "EAS revocable");
  if (revocable !== 0 && revocable !== 1) throw new Error("Human Passport EAS revocable flag is malformed.");
  return {
    uid: `0x${word(body, 0, "EAS UID")}`,
    schema: `0x${word(body, 32, "EAS schema")}`,
    time: uint(body, 2 * 32, "EAS creation time"),
    expirationTime: uint(body, 3 * 32, "EAS expiration time"),
    revocationTime: uint(body, 4 * 32, "EAS revocation time"),
    revocable: revocable === 1,
    refUid: `0x${word(body, 6 * 32, "EAS reference UID")}`,
    recipient: addressFromWord(word(body, 7 * 32, "EAS recipient"), "EAS recipient"),
    attester: addressFromWord(word(body, 8 * 32, "EAS attester"), "EAS attester"),
    data: `0x${body.slice(dataStart * 2, dataEnd * 2)}`,
  };
}

function decodeSchemaRecord(raw: string): { schema: string; resolver: string; revocable: boolean } {
  const body = hexBody(raw, "Human Passport schema record");
  if (body.length < 3 * 64) throw new Error("Human Passport schema record is truncated.");
  const schemaOffset = uint(body, 0, "schema string");
  const decoded = utf8At(body, schemaOffset, "Human Passport schema");
  if (decoded.end * 2 !== body.length) throw new Error("Human Passport schema record has trailing or missing ABI data.");
  const revocable = uint(body, 2 * 32, "schema revocable");
  if (revocable !== 0 && revocable !== 1) throw new Error("Human Passport schema revocable flag is malformed.");
  return { schema: decoded.value, resolver: addressFromWord(word(body, 32, "schema resolver"), "schema resolver"), revocable: revocable === 1 };
}

export type HumanPassportStamp = { provider: string; score: number };

function decodeUnifiedData(raw: string) {
  const body = hexBody(raw, "Human Passport unified attestation data");
  if (body.length < 6 * 64) throw new Error("Human Passport unified attestation data is truncated.");
  const passing = uint(body, 0, "passing_score");
  if (passing !== 0 && passing !== 1) throw new Error("passing_score is malformed.");
  const scoreDecimals = uint(body, 32, "score_decimals");
  const scorerId = uint(body, 64, "scorer_id");
  const rawScore = uint(body, 96, "score");
  const thresholdRaw = uint(body, 128, "threshold");
  const stampsOffset = uint(body, 160, "stamps");
  if (stampsOffset < 6 * 32) throw new Error("stamps offset is malformed.");
  const stampCount = uint(body, stampsOffset, "stamps count");
  if (stampCount > 64) throw new Error("Human Passport stamp array is too large.");
  const arrayBase = stampsOffset + 32;
  const offsetsEnd = arrayBase + stampCount * 32;
  if (offsetsEnd * 2 > body.length) throw new Error("Human Passport stamp offsets are truncated.");
  const stamps: HumanPassportStamp[] = [];
  let arrayEnd = offsetsEnd;
  for (let index = 0; index < stampCount; index += 1) {
    const elementOffset = uint(body, arrayBase + index * 32, "stamp tuple offset");
    const elementStart = arrayBase + elementOffset;
    if (elementStart < offsetsEnd) throw new Error("Human Passport stamp tuple overlaps its offset table.");
    const stringOffset = uint(body, elementStart, "stamp provider offset");
    const score = uint(body, elementStart + 32, "stamp score");
    const provider = utf8At(body, elementStart + stringOffset, "stamp provider");
    if (!provider.value || provider.value.length > 128) throw new Error("Human Passport stamp provider is malformed.");
    arrayEnd = Math.max(arrayEnd, elementStart + 64, provider.end);
    stamps.push({ provider: provider.value, score });
  }
  if (arrayEnd * 2 !== body.length) throw new Error("Human Passport stamp array has trailing or missing ABI data.");
  return { passingScore: passing === 1, scoreDecimals, scorerId, rawScore, thresholdRaw, stamps };
}

export type HumanPassportEvidence = {
  source: "legacy-decoder" | "eas-unified";
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
  attestationUid?: string;
  schemaUid?: string;
  resolver?: string;
  attester?: string;
  scorerId?: number;
  scoreDecimals?: number;
  passingScore?: boolean;
  expirationTime?: number;
  revocationTime?: number;
  stamps?: HumanPassportStamp[];
};

export async function readHumanPassport(wallet: string, blockNumber?: number): Promise<HumanPassportEvidence> {
  const subject = requireAddress(wallet).toLowerCase();
  const chainId = hexNumber(await rpc<string>("eth_chainId", []), "Human Passport chain ID");
  if (chainId !== HUMAN_PASSPORT_CHAIN_ID) throw new Error(`Human Passport RPC is on chain ${chainId}; Optimism Sepolia 11155420 is required.`);
  const block = blockNumber ?? hexNumber(await rpc<string>("eth_blockNumber", []), "Human Passport block number");
  if (!Number.isSafeInteger(block) || block <= 0) throw new Error("Human Passport block number is invalid.");
  const tag = `0x${block.toString(16)}`;
  const blockData = await rpc<{ number?: string; hash?: string; timestamp?: string }>("eth_getBlockByNumber", [tag, false]);
  if (!blockData || hexNumber(String(blockData.number || "0x0"), "Human Passport block number") !== block) throw new Error("Human Passport block changed or was unavailable.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(blockData.hash || ""))) throw new Error("Human Passport block hash is malformed.");
  const decoderCode = await rpc<string>("eth_getCode", [HUMAN_PASSPORT_DECODER, tag]);
  if (!/^0x[0-9a-fA-F]+$/.test(decoderCode) || decoderCode.length <= 2) throw new Error("Human Passport decoder has no code at the pinned block.");
  const raw = await rpc<string>("eth_call", [{ to: HUMAN_PASSPORT_DECODER, data: `0xd47875d0${addressWord(subject)}` }, tag]);
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error("Human Passport getScore returned an invalid ABI word.");
  const rawScore = Number(BigInt(raw));
  const blockTimestamp = hexNumber(String(blockData.timestamp || "0x0"), "Human Passport block timestamp");
  return { source: "legacy-decoder", wallet: subject, chainId, decoder: HUMAN_PASSPORT_DECODER, blockNumber: block, blockHash: String(blockData.hash).toLowerCase(), blockTimestamp, rawScore, score: rawScore / 10_000, thresholdRaw: HUMAN_PASSPORT_THRESHOLD_RAW, threshold: HUMAN_PASSPORT_THRESHOLD_DISPLAY, thresholdMet: rawScore >= HUMAN_PASSPORT_THRESHOLD_RAW, observedAt: Math.floor(Date.now() / 1000) };
}

export async function readUnifiedHumanPassport(wallet: string, attestationUid: string, blockNumber?: number): Promise<HumanPassportEvidence> {
  const subject = requireAddress(wallet).toLowerCase();
  const uid = requireHash(attestationUid, "Human Passport attestation UID");
  const chainId = hexNumber(await rpc<string>("eth_chainId", []), "Human Passport chain ID");
  if (chainId !== HUMAN_PASSPORT_CHAIN_ID) throw new Error(`Human Passport RPC is on chain ${chainId}; Optimism Sepolia 11155420 is required.`);
  const block = blockNumber ?? hexNumber(await rpc<string>("eth_blockNumber", []), "Human Passport block number");
  if (!Number.isSafeInteger(block) || block <= 0) throw new Error("Human Passport block number is invalid.");
  const tag = `0x${block.toString(16)}`;
  const blockData = await rpc<{ number?: string; hash?: string; timestamp?: string }>("eth_getBlockByNumber", [tag, false]);
  if (!blockData || hexNumber(String(blockData.number || "0x0"), "Human Passport block number") !== block) throw new Error("Human Passport block changed or was unavailable.");
  const blockHash = String(blockData.hash || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(blockHash)) throw new Error("Human Passport block hash is malformed.");
  const blockTimestamp = hexNumber(String(blockData.timestamp || "0x0"), "Human Passport block timestamp");
  for (const [addressValue, label] of [[HUMAN_PASSPORT_EAS, "Human Passport EAS"], [HUMAN_PASSPORT_SCHEMA_REGISTRY, "Human Passport schema registry"], [HUMAN_PASSPORT_UNIFIED_RESOLVER, "Human Passport resolver"]] as const) {
    const code = await codeAt(block, addressValue);
    if (!/^0x[0-9a-fA-F]+$/.test(code) || code.length <= 2) throw new Error(`${label} has no code at the pinned block.`);
  }
  const attestation = decodeEasAttestation(await rpc<string>("eth_call", [{ to: HUMAN_PASSPORT_EAS, data: `0xa3112a64${uid.slice(2)}` }, tag]));
  if (attestation.uid !== uid) throw new Error("Human Passport EAS UID mismatch.");
  if (attestation.schema !== HUMAN_PASSPORT_UNIFIED_SCHEMA_UID) throw new Error("Human Passport schema UID is not the approved unified schema.");
  if (attestation.recipient.toLowerCase() !== subject) throw new Error("Human Passport recipient does not match the assessed wallet.");
  if (attestation.attester !== HUMAN_PASSPORT_PERMITTED_ATTESTER) throw new Error("Human Passport attester is not permitted.");
  if (!attestation.revocable || attestation.revocationTime !== 0) throw new Error("Human Passport attestation is revoked or not safely revocable.");
  if (attestation.time > blockTimestamp || attestation.expirationTime <= blockTimestamp) throw new Error("Human Passport attestation is not valid at the pinned block.");
  const schema = decodeSchemaRecord(await rpc<string>("eth_call", [{ to: HUMAN_PASSPORT_SCHEMA_REGISTRY, data: `0xa2ea7c6e${HUMAN_PASSPORT_UNIFIED_SCHEMA_UID.slice(2)}` }, tag]));
  if (schema.schema !== HUMAN_PASSPORT_UNIFIED_SCHEMA || schema.resolver !== HUMAN_PASSPORT_UNIFIED_RESOLVER || !schema.revocable) throw new Error("Human Passport schema registry record is not the approved unified configuration.");
  const decoded = decodeUnifiedData(attestation.data);
  if (decoded.scoreDecimals !== 4 || decoded.scorerId !== HUMAN_PASSPORT_APPROVED_SCORER_ID || decoded.thresholdRaw !== HUMAN_PASSPORT_THRESHOLD_RAW) throw new Error("Human Passport score metadata is not approved.");
  if (decoded.passingScore !== (decoded.rawScore >= decoded.thresholdRaw)) throw new Error("Human Passport passing flag contradicts score and threshold.");
  const now = Math.floor(Date.now() / 1000);
  if (attestation.expirationTime <= now) throw new Error("Human Passport unified attestation is expired.");
  if (now - blockTimestamp > HUMAN_PASSPORT_MAX_AGE_SECONDS) throw new Error("Human Passport pinned evidence block is stale.");
  return { source: "eas-unified", wallet: subject, chainId, decoder: HUMAN_PASSPORT_EAS, blockNumber: block, blockHash, blockTimestamp, rawScore: decoded.rawScore, score: decoded.rawScore / 10 ** decoded.scoreDecimals, thresholdRaw: HUMAN_PASSPORT_THRESHOLD_RAW, threshold: HUMAN_PASSPORT_THRESHOLD_DISPLAY, thresholdMet: decoded.passingScore && decoded.rawScore >= HUMAN_PASSPORT_THRESHOLD_RAW, observedAt: now, attestationUid: uid, schemaUid: attestation.schema, resolver: schema.resolver, attester: attestation.attester, scorerId: decoded.scorerId, scoreDecimals: decoded.scoreDecimals, passingScore: decoded.passingScore, expirationTime: attestation.expirationTime, revocationTime: attestation.revocationTime, stamps: decoded.stamps };
}

export function humanPassportAttestationUrl(uid: string): string {
  return `https://optimism-sepolia.easscan.org/attestation/view/${uid}`;
}

export function humanPassportDocumentationUrl(): string {
  return "https://docs.passport.human.tech/building-with-passport/stamps/smart-contracts/attestation-schema";
}

export function humanPassportAppUrl(): string {
  return "https://app.passport.xyz";
}
