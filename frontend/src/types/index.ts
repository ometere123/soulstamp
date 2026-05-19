export type Platform = "github" | "twitter" | "discord";

export interface LinkedAccount {
  platform: Platform;
  username: string;
  profile_url: string;
  verified_at: number;
  confidence_score: number;
  bot_score: number;
  reasoning: string;
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
  requested_at: number;
  expires_at: number;
}

export interface PlatformLookupResult {
  found: boolean;
  owner_address?: string;
  reputation_score?: number;
  is_flagged?: boolean;
  verification_count?: number;
}

export interface AuditEntry {
  action: string;
  platform: string;
  username: string;
  result: string;
  confidence: number;
  bot_score: number;
  timestamp: number;
}

export interface PlatformStats {
  total_verifications: number;
  total_identities: number;
  admin: string;
  supported_platforms: string[];
  discord_attestation_base_url?: string;
}

export type VerificationStep =
  | "idle"
  | "requesting"
  | "pending"
  | "completing"
  | "done"
  | "error";
