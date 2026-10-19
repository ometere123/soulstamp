export const GOOGLE_WORKER_URL = (import.meta.env.VITE_GOOGLE_WORKER_URL || import.meta.env.VITE_DISCORD_BACKEND_URL || "https://soulstamp-discord.delealufejoel.workers.dev").replace(/\/$/, "");

const GOOGLE_CALLBACK_STORAGE_KEY = "soulstamp:google-callback:v1";

export type GoogleCallback = {
  status: "ready" | "error" | "none";
  attestationUrl?: string;
  pendingId?: string;
  error?: string;
};

export type RequestLike = { request_id: string; subject?: string };

export function googleStartUrl(wallet: string, pendingId: string, v4Contract: string): string {
  if (!GOOGLE_WORKER_URL) throw new Error("Google Worker URL is not configured.");
  const returnTo = `${window.location.origin}${window.location.pathname}`;
  const url = new URL(`${GOOGLE_WORKER_URL}/api/google/start`);
  url.searchParams.set("wallet", wallet);
  url.searchParams.set("pending_id", pendingId);
  url.searchParams.set("v4_contract", v4Contract);
  url.searchParams.set("chain_id", "61999");
  url.searchParams.set("purpose", "google_link");
  url.searchParams.set("return_to", returnTo);
  return url.toString();
}

export function readGoogleCallback(search = typeof window === "undefined" ? "" : window.location.search): GoogleCallback {
  const params = new URLSearchParams(search);
  const error = params.get("google_error");
  if (error) return { status: "error", error };
  if (params.get("google_status") !== "ready") return { status: "none" };
  const attestationUrl = params.get("google_attestation_url");
  const pendingId = params.get("google_pending_id") || undefined;
  if (!attestationUrl || !pendingId) return { status: "error", error: "Google returned incomplete evidence for the pending request." };
  try {
    const evidence = new URL(attestationUrl);
    const worker = new URL(GOOGLE_WORKER_URL);
    if (evidence.protocol !== "https:" || evidence.origin !== worker.origin || !evidence.pathname.startsWith("/api/google/attestations/")) {
      return { status: "error", error: "Google returned an unsafe evidence URL." };
    }
  } catch {
    return { status: "error", error: "Google returned an invalid evidence URL." };
  }
  return { status: "ready", attestationUrl, pendingId };
}

export function clearGoogleCallback(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  ["google_status", "google_attestation_url", "google_pending_id", "google_error"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function storeGoogleCallback(callback: GoogleCallback): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(GOOGLE_CALLBACK_STORAGE_KEY, JSON.stringify(callback)); } catch { /* private browsing may disable storage */ }
}

export function readStoredGoogleCallback(): GoogleCallback {
  if (typeof window === "undefined") return { status: "none" };
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_CALLBACK_STORAGE_KEY);
    if (!raw) return { status: "none" };
    const parsed = JSON.parse(raw) as GoogleCallback;
    return parsed?.status === "ready" || parsed?.status === "error" ? parsed : { status: "none" };
  } catch { return { status: "none" }; }
}

export function clearStoredGoogleCallback(): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(GOOGLE_CALLBACK_STORAGE_KEY); } catch { /* ignore storage failures */ }
}

/** Capture callback evidence before removing signed URL material from history. */
export function captureGoogleCallback(search = typeof window === "undefined" ? "" : window.location.search): GoogleCallback {
  const fromUrl = readGoogleCallback(search);
  if (fromUrl.status !== "none") {
    storeGoogleCallback(fromUrl);
    clearGoogleCallback();
    return fromUrl;
  }
  return readStoredGoogleCallback();
}

export function selectGoogleRequest<T extends RequestLike>(requests: T[], callback: GoogleCallback, wallet?: string): T | null {
  if (callback.status !== "ready" || !callback.pendingId) return null;
  const request = requests.find((candidate) => candidate.request_id === callback.pendingId) || null;
  if (!request || (wallet && request.subject && request.subject.toLowerCase() !== wallet.toLowerCase())) return null;
  return request;
}

export function authCallbackTab(callback: GoogleCallback, discordSearch = ""): "trustpass" | "verify" | null {
  if (callback.status !== "none") return "trustpass";
  return discordSearch.includes("discord_session=") || discordSearch.includes("discord_error=") ? "verify" : null;
}
