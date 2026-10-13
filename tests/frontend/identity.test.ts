import { describe, expect, it } from "vitest";
import postState from "../fixtures/verification_post_state.json";
import { hasLinkedAccount } from "../../frontend/src/lib/identity";
import { evidenceAssuranceLabel } from "../../frontend/src/lib/evidence";
import type { IdentityRecord } from "../../frontend/src/types";

function identityWith(platform: "github" | "twitter", username: string): IdentityRecord {
  return {
    found: true,
    owner: "0x" + "1".repeat(40),
    linked_accounts: [{ platform, username, profile_url: "", verified_at: 1, confidence_score: 90, bot_score: 10, reasoning: "" }],
    reputation_score: 0,
    is_flagged: false,
    flag_reason: "",
    created_at: 1,
    last_updated: 1,
    verification_count: 1,
  };
}

describe("identity post-state confirmation", () => {
  it("confirms the exact linked account after a finalized write", () => {
    expect(hasLinkedAccount(identityWith("github", "Alice"), "github", "alice")).toBe(true);
  });

  it("models pending creation, consumption, and the resulting identity post-state", () => {
    expect(postState.pending_created.found).toBe(true);
    expect(postState.pending_created.pending_id).toBeTruthy();
    expect(postState.pending_consumed.found).toBe(false);
    expect(hasLinkedAccount(
      postState.identity_after_completion as IdentityRecord,
      "twitter",
      "papito_dele",
    )).toBe(true);
  });

  it("does not treat an unrelated identity or platform as completion", () => {
    expect(hasLinkedAccount(identityWith("github", "alice"), "twitter", "alice")).toBe(false);
    expect(hasLinkedAccount({ ...identityWith("github", "alice"), found: false, linked_accounts: [] }, "github", "alice")).toBe(false);
  });

  it("uses evidence assurance and protocol risk labels instead of bot-detection claims", () => {
    expect(evidenceAssuranceLabel("MEDIUM", "medium")).toBe("MEDIUM evidence · medium protocol risk");
    expect(evidenceAssuranceLabel(undefined, undefined)).toBe("MEDIUM evidence · medium protocol risk");
  });
});
