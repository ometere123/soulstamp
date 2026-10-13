import type { OwnershipChallenge } from "../types";

export interface ChallengeActionState {
  canResolve: boolean;
  canExpire: boolean;
  resolutionReason: string;
  expiryReason: string;
}

export interface ChallengeActorActionState extends ChallengeActionState {
  isOwner: boolean;
  isChallenger: boolean;
  isParty: boolean;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * The contract's resolution gates are state/deadline gates, not caller gates.
 * Either named party may submit resolve once the evidence path is valid; the
 * admin surface uses this same state-only helper for its oversight control.
 */
export function getChallengeActionState(
  challenge: Pick<OwnershipChallenge, "status" | "rebuttal_deadline" | "challenger_evidence_deadline">,
  at = nowSeconds(),
): ChallengeActionState {
  const challengerDeadline = Number(challenge.challenger_evidence_deadline ?? 0);
  const rebuttalDeadline = Number(challenge.rebuttal_deadline ?? 0);

  if (challenge.status === "RESPONDED") {
    return {
      canResolve: true,
      canExpire: false,
      resolutionReason: "Both evidence paths were accepted; independent resolution is available now.",
      expiryReason: "An answered challenge cannot be expired.",
    };
  }

  if (challenge.status === "AWAITING_REBUTTAL") {
    if (rebuttalDeadline > 0 && at >= rebuttalDeadline) {
      return {
        canResolve: true,
        canExpire: false,
        resolutionReason: "The owner’s rebuttal deadline elapsed; an owner rebuttal is optional now.",
        expiryReason: "A challenge with accepted evidence cannot be expired.",
      };
    }
    return {
      canResolve: false,
      canExpire: false,
      resolutionReason: rebuttalDeadline > 0
        ? "Resolve is disabled until the owner’s rebuttal deadline. The owner may still submit a rebuttal before then."
        : "Resolve is disabled because no valid rebuttal deadline was recorded.",
      expiryReason: "Accepted challenger evidence keeps the challenge open for resolution.",
    };
  }

  if (challenge.status === "OPEN") {
    const expired = challengerDeadline > 0 && at >= challengerDeadline;
    return {
      canResolve: false,
      canExpire: expired,
      resolutionReason: expired
        ? "Resolve is unavailable: no challenger evidence was accepted before the evidence deadline."
        : "Resolve is disabled while the challenge is OPEN; valid challenger evidence must be accepted first.",
      expiryReason: expired
        ? "The challenger-evidence deadline elapsed without accepted evidence; the unanswered challenge can be expired."
        : "Expire is disabled until the challenger-evidence deadline elapses.",
    };
  }

  return {
    canResolve: false,
    canExpire: false,
    resolutionReason: "This challenge is already terminal or is not resolvable in its current state.",
    expiryReason: "This challenge is not an unanswered OPEN challenge.",
  };
}

export function getChallengeActorActionState(
  challenge: Pick<OwnershipChallenge, "status" | "rebuttal_deadline" | "challenger_evidence_deadline" | "current_owner" | "challenger_wallet">,
  address: string | null | undefined,
  at = nowSeconds(),
): ChallengeActorActionState {
  const actor = (address ?? "").toLowerCase();
  const isOwner = Boolean(actor) && challenge.current_owner.toLowerCase() === actor;
  const isChallenger = Boolean(actor) && challenge.challenger_wallet.toLowerCase() === actor;
  const isParty = isOwner || isChallenger;
  const state = getChallengeActionState(challenge, at);

  return {
    ...state,
    isOwner,
    isChallenger,
    isParty,
    canResolve: isParty && state.canResolve,
    canExpire: isParty && state.canExpire,
    resolutionReason: isParty
      ? state.resolutionReason
      : "Only the original owner or challenger can use these challenge controls.",
    expiryReason: isParty
      ? state.expiryReason
      : "Only the original owner or challenger can expire this challenge.",
  };
}
