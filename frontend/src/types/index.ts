export type Platform = "github" | "twitter" | "discord";
export type ProofStatus = "ACTIVE" | "STALE" | "REVOKED" | "CONFLICTED" | "FLAGGED";
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
}

export interface PlatformStats {
  total_verifications: number;
  total_identities: number;
  admin: string;
  supported_platforms: string[];
  proof_statuses?: ProofStatus[];
  verifier_version?: string;
  discord_attestation_base_url?: string;
}

export type VerificationStep =
  | "idle"
  | "requesting"
  | "pending"
  | "completing"
  | "done"
  | "error";
