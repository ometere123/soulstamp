import { describe, expect, it } from "vitest";
import {
  authCallbackTab,
  readGoogleCallback,
  selectGoogleRequest,
  type GoogleCallback,
} from "../../frontend/src/lib/google";
import { parseDiscordOAuthResult } from "../../frontend/src/lib/discord";

const workerEvidence = "https://soulstamp-discord.delealufejoel.workers.dev/api/google/attestations/signed-token";
const pendingId = "AAAAAAAAAAAAAAAAAAAAAAAA";

describe("Google OAuth callback handoff", () => {
  it("captures a ready callback with its exact pending request", () => {
    expect(readGoogleCallback(`?google_status=ready&google_attestation_url=${encodeURIComponent(workerEvidence)}&google_pending_id=${pendingId}`)).toEqual({
      status: "ready",
      attestationUrl: workerEvidence,
      pendingId,
    });
  });

  it("rejects missing request binding and unsafe evidence origins", () => {
    expect(readGoogleCallback(`?google_status=ready&google_attestation_url=${encodeURIComponent(workerEvidence)}`)).toMatchObject({ status: "error" });
    expect(readGoogleCallback(`?google_status=ready&google_attestation_url=${encodeURIComponent("https://attacker.example/api/google/attestations/token")}&google_pending_id=${pendingId}`)).toMatchObject({ status: "error" });
  });

  it("restores only the request named by google_pending_id", () => {
    const callback: GoogleCallback = { status: "ready", attestationUrl: workerEvidence, pendingId };
    const requests = [
      { request_id: "OTHER", subject: "0x1111111111111111111111111111111111111111" },
      { request_id: pendingId, subject: "0x2222222222222222222222222222222222222222" },
    ];
    expect(selectGoogleRequest(requests, callback, "0x2222222222222222222222222222222222222222")?.request_id).toBe(pendingId);
    expect(selectGoogleRequest(requests, callback, "0x3333333333333333333333333333333333333333")).toBeNull();
  });

  it("does not treat an error callback as a linkable request", () => {
    const callback: GoogleCallback = { status: "error", error: "consent denied" };
    expect(selectGoogleRequest([{ request_id: pendingId }], callback)).toBeNull();
  });

  it("keeps Discord callback data on the Verify Identity path", () => {
    expect(parseDiscordOAuthResult("?discord_session=session&discord_id=123&discord_username=alice")).toMatchObject({
      sessionId: "session",
      id: "123",
      username: "alice",
    });
    expect(authCallbackTab({ status: "none" }, "?discord_session=session")).toBe("verify");
    expect(authCallbackTab({ status: "ready", attestationUrl: workerEvidence, pendingId }, "?discord_session=session")).toBe("trustpass");
  });
});
