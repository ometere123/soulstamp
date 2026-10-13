import { describe, expect, it } from "vitest";
import { getChallengeActionState, getChallengeActorActionState } from "../../frontend/src/lib/challenge";
import type { OwnershipChallenge } from "../../frontend/src/types";

const owner = "0x1111111111111111111111111111111111111111";
const challenger = "0x2222222222222222222222222222222222222222";
const unrelated = "0x3333333333333333333333333333333333333333";

function challenge(status: OwnershipChallenge["status"], overrides: Partial<OwnershipChallenge> = {}): OwnershipChallenge {
  return {
    challenge_id: "CHALLENGE",
    platform: "github",
    username: "alice",
    canonical_platform_id: "123",
    current_owner: owner,
    challenger_wallet: challenger,
    challenger_code: "challenger-code",
    owner_rebuttal_code: "owner-code",
    challenger_evidence_url: "",
    owner_rebuttal_url: "",
    owner_rebuttal_statement: "",
    challenger_evidence_status: "STALE",
    owner_evidence_status: "STALE",
    challenger_canonical_id: "",
    owner_canonical_id: "",
    opened_at: 1,
    rebuttal_deadline: 200,
    challenger_evidence_deadline: 100,
    resolved_at: 0,
    recovery_not_before: 0,
    status,
    outcome: "",
    reason_code: "",
    resolution_reasoning: "",
    recovery_executed_at: 0,
    ...overrides,
  };
}

describe("challenge resolution and expiry controls", () => {
  it("enables resolve for both named parties after RESPONDED", () => {
    const item = challenge("RESPONDED");
    expect(getChallengeActorActionState(item, owner, 50).canResolve).toBe(true);
    expect(getChallengeActorActionState(item, challenger, 50).canResolve).toBe(true);
  });

  it("keeps unrelated wallets out of party controls", () => {
    const state = getChallengeActorActionState(challenge("RESPONDED"), unrelated, 50);
    expect(state.isParty).toBe(false);
    expect(state.canResolve).toBe(false);
    expect(state.resolutionReason).toMatch(/original owner or challenger/i);
  });

  it("disables AWAITING_REBUTTAL resolution before the owner deadline", () => {
    const state = getChallengeActionState(challenge("AWAITING_REBUTTAL"), 199);
    expect(state.canResolve).toBe(false);
    expect(state.canExpire).toBe(false);
    expect(state.resolutionReason).toMatch(/rebuttal deadline/i);
  });

  it("enables AWAITING_REBUTTAL resolution at the deadline without requiring a rebuttal", () => {
    const state = getChallengeActionState(challenge("AWAITING_REBUTTAL"), 200);
    expect(state.canResolve).toBe(true);
    expect(state.resolutionReason).toMatch(/optional/i);
  });

  it("does not require a rebuttal after the response deadline", () => {
    const state = getChallengeActionState(challenge("AWAITING_REBUTTAL", { owner_rebuttal_url: "" }), 201);
    expect(state.canResolve).toBe(true);
  });

  it("never resolves OPEN, and only exposes expiry after the evidence deadline", () => {
    const before = getChallengeActionState(challenge("OPEN"), 99);
    expect(before.canResolve).toBe(false);
    expect(before.canExpire).toBe(false);
    expect(before.resolutionReason).toMatch(/OPEN/i);

    const at = getChallengeActionState(challenge("OPEN"), 100);
    expect(at.canResolve).toBe(false);
    expect(at.canExpire).toBe(true);
    expect(at.expiryReason).toMatch(/deadline elapsed/i);
  });

  it("uses the exact deadline boundary and keeps terminal states disabled", () => {
    expect(getChallengeActionState(challenge("OPEN"), 100).canExpire).toBe(true);
    expect(getChallengeActionState(challenge("RESOLVED_INCONCLUSIVE"), 500).canResolve).toBe(false);
    expect(getChallengeActionState(challenge("EXPIRED"), 500).canExpire).toBe(false);
  });
});
