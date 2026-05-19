export interface DiscordOAuthResult {
  sessionId: string;
  id: string;
  username: string;
  displayName: string;
  claim: string;
}

export interface DiscordAttestationResult {
  attestation_url: string;
  expires_at: number;
  discord_id: string;
  claimed_username: string;
}

export const DISCORD_BACKEND_URL = (import.meta.env.VITE_DISCORD_BACKEND_URL || "").replace(/\/$/, "");

export function hasDiscordBackend(): boolean {
  return Boolean(DISCORD_BACKEND_URL);
}

export function discordStartUrl(wallet: string, returnTo: string): string {
  if (!DISCORD_BACKEND_URL) throw new Error("VITE_DISCORD_BACKEND_URL is not set");
  const url = new URL(`${DISCORD_BACKEND_URL}/api/discord/start`);
  url.searchParams.set("wallet", wallet);
  url.searchParams.set("return_to", returnTo);
  return url.toString();
}

export function parseDiscordOAuthResult(search: string): DiscordOAuthResult | null {
  const params = new URLSearchParams(search);
  const sessionId = params.get("discord_session");
  const id = params.get("discord_id");
  if (!sessionId || !id) return null;
  const username = params.get("discord_username") || "";
  const displayName = params.get("discord_display") || username || id;
  const claim = params.get("discord_claim") || `${displayName}#${id}`;
  return { sessionId, id, username, displayName, claim };
}

export function discordOAuthError(search: string): string | null {
  return new URLSearchParams(search).get("discord_error");
}

export function clearDiscordOAuthParams() {
  const url = new URL(window.location.href);
  for (const key of [
    "discord_session",
    "discord_id",
    "discord_username",
    "discord_display",
    "discord_claim",
    "discord_error",
  ]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", url.toString());
}

export async function createDiscordAttestation(input: {
  sessionId: string;
  wallet: string;
  verificationCode: string;
  claimedUsername: string;
}): Promise<DiscordAttestationResult> {
  if (!DISCORD_BACKEND_URL) throw new Error("VITE_DISCORD_BACKEND_URL is not set");
  const response = await fetch(`${DISCORD_BACKEND_URL}/api/discord/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: input.sessionId,
      wallet: input.wallet,
      verification_code: input.verificationCode,
      claimed_username: input.claimedUsername,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Discord attestation failed");
  }
  return body as DiscordAttestationResult;
}
