export type Platform = "github" | "twitter" | "discord";
export type ProofStatus = "ACTIVE" | "STALE" | "REVOKED" | "CONFLICTED" | "FLAGGED" | "RECOVERED";
export type ProofStrength = "STRONG" | "MEDIUM" | "WEAK";
export type RiskBand = "low" | "medium" | "high";

export interface ProofDossier {
  platform: Platform;
  username: string;
  canonical_platform_id: string;
  proof_url: string;
  verification_code: string;
  pending_id: string;
  proof_strength: ProofStrength;
  risk_band: RiskBand;
  confidence_bucket: number;
  reason_code: string;
  proof_status: ProofStatus;
  verification_method: string;
  verifier_version: string;
  audit_ref: number;
  verified_wallet: string;
  created_marker: number;
  updated_marker: number;
  evidence_issued_at?: number;
  evidence_expires_at?: number;
}

export interface LinkedAccount {
  platform: Platform;
  username: string;
  profile_url: string;
  verified_at: number;
  confidence_score: number;
  bot_score: number;
  reasoning: string;
  is_active?: boolean;
  proof_status?: ProofStatus;
  proof_strength?: ProofStrength;
  risk_band?: RiskBand;
  canonical_platform_id?: string;
  verification_code?: string;
  pending_id?: string;
  proof_url?: string;
  reason_code?: string;
  last_checked_marker?: number;
  dossier?: ProofDossier;
  status_before_flag?: string;
}

export interface IdentityRecord {
  found: boolean;
  owner: string;
  linked_accounts: LinkedAccount[];
  reputation_score: number;
  is_flagged: boolean;
  flag_reason: string;
  created_at: number;
  last_updated: number;
  verification_count: number;
  principal_id?: string;
  identity_state?: "ACTIVE" | "FLAGGED" | "RECOVERY_PENDING" | "CONTESTED" | "RECOVERED";
  recovery_target?: string;
  eligible?: boolean;
  eligibility_reason?: string;
}

export interface PendingVerification {
  found: boolean;
  platform: Platform;
  username: string;
  profile_url: string;
  verification_code: string;
  pending_id?: string;
  request_nonce?: number;
  requested_at: number;
  expires_at: number;
}

export interface PlatformLookupResult {
  found: boolean;
  owner_address?: string;
  reputation_score?: number;
  is_flagged?: boolean;
  verification_count?: number;
  proof_status?: ProofStatus;
  canonical_platform_id?: string;
  identity_state?: string;
  eligible?: boolean;
  eligibility_reason?: string;
}

export interface AuditEntry {
  action: string;
  platform: string;
  username: string;
  result: string;
  confidence: number;
  bot_score: number;
  timestamp: number;
  proof_status?: ProofStatus;
  reason_code?: string;
  actor?: string;
  details?: string;
  previous_hash?: string;
  event_hash?: string;
}

export interface PlatformStats {
  total_verifications: number;
  total_identities: number;
  admin: string;
  supported_platforms: string[];
  proof_statuses?: ProofStatus[];
  verifier_version?: string;
  discord_attestation_base_url?: string;
  total_challenges?: number;
  total_recoveries?: number;
  challenge_statuses?: string[];
  legacy_contract_address?: string;
}

export type ChallengeStatus =
  | "OPEN"
  | "AWAITING_REBUTTAL"
  | "RESPONDED"
  | "RESOLVED_OWNER"
  | "RESOLVED_CHALLENGER"
  | "RESOLVED_INCONCLUSIVE"
  | "EXECUTED"
  | "EXPIRED";

export interface OwnershipChallenge {
  found?: boolean;
  challenge_id: string;
  platform: Platform;
  username: string;
  canonical_platform_id: string;
  current_owner: string;
  challenger_wallet: string;
  challenger_code: string;
  owner_rebuttal_code: string;
  challenger_evidence_url: string;
  owner_rebuttal_url: string;
  owner_rebuttal_statement: string;
  challenger_evidence_status: ProofStatus;
  owner_evidence_status: ProofStatus;
  challenger_canonical_id: string;
  owner_canonical_id: string;
  opened_at: number;
  rebuttal_deadline: number;
  challenger_evidence_deadline?: number;
  challenger_evidence_hash?: string;
  owner_rebuttal_hash?: string;
  challenger_evidence_commitment?: string;
  owner_rebuttal_commitment?: string;
  challenger_evidence_accepted_at?: number;
  owner_rebuttal_accepted_at?: number;
  resolved_at: number;
  recovery_not_before: number;
  status: ChallengeStatus;
  outcome: string;
  reason_code: string;
  resolution_reasoning: string;
  recovery_executed_at: number;
}

export type VerificationStep =
  | "idle"
  | "requesting"
  | "pending"
  | "completing"
  | "done"
  | "error";
