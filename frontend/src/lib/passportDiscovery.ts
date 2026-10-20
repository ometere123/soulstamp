import { HUMAN_PASSPORT_APPROVED_SCORER_ID, HUMAN_PASSPORT_UNIFIED_SCHEMA_UID, HUMAN_PASSPORT_PERMITTED_ATTESTER } from "./humanPassport";

export const PASSPORT_DISCOVERY_URL = (
  import.meta.env.VITE_PASSPORT_DISCOVERY_URL
  || import.meta.env.VITE_GOOGLE_WORKER_URL
  || import.meta.env.VITE_DISCORD_BACKEND_URL
  || "https://soulstamp-discord.delealufejoel.workers.dev"
).replace(/\/$/, "");

export type PassportDiscoveryCandidate = {
  attestation_uid: string;
  recipient: string;
  schema_uid: string;
  attester: string;
  time: number;
  expiration_time: number;
  revocation_time: number;
  revocable: boolean;
};

export type PassportApiSummary = {
  available: boolean;
  scorer_id?: string;
  matches_approved_scorer?: boolean;
  score?: number | null;
  passing_score?: boolean | null;
  stamp_count?: number;
  stamps?: { provider: string; score: number | null }[];
  last_score_timestamp?: string | null;
  expiration_timestamp?: number | null;
  error_code?: string;
};

export type PassportDiscovery = {
  wallet: string;
  chain_id: number;
  approved_schema_uid: string;
  approved_attester: string;
  approved_scorer_id: number;
  passport_api: PassportApiSummary;
  eas_indexer: { endpoint: string; candidates: PassportDiscoveryCandidate[]; error_code?: string };
  candidate: PassportDiscoveryCandidate | null;
  candidate_count: number;
  authority: "candidate_only_until_direct_eas_validation";
};

function requireWallet(wallet: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error("The connected wallet address is malformed.");
  return wallet;
}

function isCandidate(value: unknown): value is PassportDiscoveryCandidate {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.attestation_uid === "string"
    && /^0x[0-9a-f]{64}$/i.test(item.attestation_uid)
    && typeof item.recipient === "string"
    && /^0x[0-9a-f]{40}$/i.test(item.recipient)
    && String(item.schema_uid).toLowerCase() === HUMAN_PASSPORT_UNIFIED_SCHEMA_UID
    && String(item.attester).toLowerCase() === HUMAN_PASSPORT_PERMITTED_ATTESTER
    && Number.isSafeInteger(item.time)
    && Number.isSafeInteger(item.expiration_time)
    && Number.isSafeInteger(item.revocation_time)
    && typeof item.revocable === "boolean";
}

function parseDiscovery(value: unknown, wallet: string): PassportDiscovery {
  if (!value || typeof value !== "object") throw new Error("Passport discovery returned a malformed response.");
  const body = value as Record<string, unknown>;
  if (String(body.wallet).toLowerCase() !== wallet.toLowerCase()) throw new Error("Passport discovery returned a different wallet.");
  if (Number(body.chain_id) !== 11155420 || Number(body.approved_scorer_id) !== HUMAN_PASSPORT_APPROVED_SCORER_ID) throw new Error("Passport discovery is configured for an unsupported network or scorer.");
  const api = body.passport_api && typeof body.passport_api === "object" ? body.passport_api as PassportApiSummary : { available: false, error_code: "PASSPORT_API_MALFORMED" };
  const indexer = body.eas_indexer && typeof body.eas_indexer === "object" ? body.eas_indexer as PassportDiscovery["eas_indexer"] : { endpoint: "", candidates: [], error_code: "PASSPORT_INDEXER_MALFORMED" };
  if (api.available) {
    if (api.scorer_id !== undefined && !/^\d{1,12}$/.test(String(api.scorer_id))) throw new Error("Passport API scorer ID is malformed.");
    if (api.score !== null && api.score !== undefined && (!Number.isFinite(Number(api.score)) || Number(api.score) < 0 || Number(api.score) > 100)) throw new Error("Passport API score is malformed.");
    if (api.stamp_count !== undefined && (!Number.isSafeInteger(Number(api.stamp_count)) || Number(api.stamp_count) < 0 || Number(api.stamp_count) > 128)) throw new Error("Passport API stamp count is malformed.");
  }
  const candidates = Array.isArray(indexer.candidates) ? indexer.candidates.filter(isCandidate) : [];
  const candidate = isCandidate(body.candidate) ? body.candidate : null;
  if (candidate && candidate.recipient.toLowerCase() !== wallet.toLowerCase()) throw new Error("Passport candidate is not bound to the connected wallet.");
  return {
    wallet: wallet.toLowerCase(),
    chain_id: Number(body.chain_id),
    approved_schema_uid: String(body.approved_schema_uid || "").toLowerCase(),
    approved_attester: String(body.approved_attester || "").toLowerCase(),
    approved_scorer_id: Number(body.approved_scorer_id),
    passport_api: api,
    eas_indexer: { endpoint: String(indexer.endpoint || ""), candidates, ...(indexer.error_code ? { error_code: String(indexer.error_code) } : {}) },
    candidate,
    candidate_count: Number(body.candidate_count || candidates.length),
    authority: "candidate_only_until_direct_eas_validation",
  };
}

/**
 * Server-side discovery only finds a candidate. The caller must pass the UID
 * through readUnifiedHumanPassport before it is eligible for an on-chain
 * attachment. No API score is accepted as a substitute for EAS evidence.
 */
export async function discoverPassport(wallet: string): Promise<PassportDiscovery> {
  const subject = requireWallet(wallet);
  if (!PASSPORT_DISCOVERY_URL) throw new Error("Passport discovery Worker is not configured.");
  const response = await fetch(`${PASSPORT_DISCOVERY_URL}/api/passport/discover?wallet=${encodeURIComponent(subject)}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (text.length > 256 * 1024) throw new Error("Passport discovery response is too large.");
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error("Passport discovery Worker returned invalid JSON."); }
  if (!response.ok) {
    const error = body && typeof body === "object" ? String((body as Record<string, unknown>).error || "Passport discovery failed") : "Passport discovery failed";
    throw new Error(error);
  }
  return parseDiscovery(body, subject);
}
