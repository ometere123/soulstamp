export const GOOGLE_WORKER_URL = (import.meta.env.VITE_GOOGLE_WORKER_URL || import.meta.env.VITE_DISCORD_BACKEND_URL || "https://soulstamp-discord.delealufejoel.workers.dev").replace(/\/$/, "");

export type GoogleCallback = {
  status: "ready" | "error" | "none";
  attestationUrl?: string;
  pendingId?: string;
  error?: string;
};

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

export function readGoogleCallback(search = window.location.search): GoogleCallback {
  const params = new URLSearchParams(search);
  const error = params.get("google_error");
  if (error) return { status: "error", error };
  const attestationUrl = params.get("google_attestation_url");
  if (!attestationUrl) return { status: "none" };
  if (!/^https:\/\//.test(attestationUrl)) return { status: "error", error: "Google returned an unsafe evidence URL." };
  return { status: "ready", attestationUrl, pendingId: params.get("google_pending_id") || undefined };
}

export function clearGoogleCallback(): void {
  const url = new URL(window.location.href);
  ["google_status", "google_attestation_url", "google_pending_id", "google_error"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, url.toString());
}
