import { readClient, getWriteClient, CONTRACT_ADDRESS } from "./client";
import { TransactionStatus } from "genlayer-js/types";
import { executionFailureDescription, isFinalizedSuccessfulReceipt } from "./finality";
import type {
  AuditEntry,
  IdentityRecord,
  OwnershipChallenge,
  PendingVerification,
  PlatformLookupResult,
  PlatformStats,
} from "../types";

function addr(): `0x${string}` {
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");
  return CONTRACT_ADDRESS;
}

async function readWithTimeout<T>(label: string, fn: () => Promise<T>, ms = 45_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      fn(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`read ${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readContractValue<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return await readClient.readContract({
    address: addr(),
    functionName,
    args: args as any[],
  }) as unknown as T;
}

export async function getIdentity(address: string, timeoutMs?: number): Promise<IdentityRecord> {
  return readWithTimeout("get_identity", () => readContractValue<IdentityRecord>("get_identity", [address]), timeoutMs);
}

export async function getPendingVerification(address: string, timeoutMs?: number): Promise<PendingVerification> {
  return readWithTimeout("get_pending_verification", () => readContractValue<PendingVerification>("get_pending_verification", [address]), timeoutMs);
}

export async function lookupByPlatform(platform: string, username: string, timeoutMs?: number): Promise<PlatformLookupResult> {
  return readWithTimeout("lookup_by_platform", () => readContractValue<PlatformLookupResult>("lookup_by_platform", [platform, username]), timeoutMs);
}

export async function isPlatformTaken(platform: string, username: string, timeoutMs?: number): Promise<boolean> {
  return readWithTimeout("is_platform_taken", () => readContractValue<boolean>("is_platform_taken", [platform, username]), timeoutMs);
}

export async function getAuditLog(address: string, timeoutMs?: number): Promise<AuditEntry[]> {
  return readWithTimeout("get_audit_log", () => readContractValue<AuditEntry[]>("get_audit_log", [address]), timeoutMs);
}

export async function getStats(timeoutMs?: number): Promise<PlatformStats> {
  return readWithTimeout("get_stats", () => readContractValue<PlatformStats>("get_stats"), timeoutMs);
}

export async function getAllAddresses(offset: number, limit: number, timeoutMs?: number): Promise<string[]> {
  return readWithTimeout("get_all_addresses", () => readContractValue<string[]>("get_all_addresses", [offset, limit]), timeoutMs);
}

export async function getConsumerEligibility(address: string, timeoutMs?: number): Promise<Record<string, unknown>> {
  return readWithTimeout("consumer_eligibility", () => readContractValue<Record<string, unknown>>("consumer_eligibility", [address]), timeoutMs);
}

export async function isEligible(address: string, timeoutMs?: number): Promise<boolean> {
  return readWithTimeout("is_eligible", () => readContractValue<boolean>("is_eligible", [address]), timeoutMs);
}

export async function getChallenge(challengeId: string, timeoutMs?: number): Promise<OwnershipChallenge> {
  return readWithTimeout("get_challenge", () => readContractValue<OwnershipChallenge>("get_challenge", [challengeId]), timeoutMs);
}

export async function getChallenges(address: string, offset = 0, limit = 50, timeoutMs?: number): Promise<OwnershipChallenge[]> {
  return readWithTimeout("get_challenges", () => readContractValue<OwnershipChallenge[]>("get_challenges", [address, offset, limit]), timeoutMs);
}

export async function getAllChallenges(offset = 0, limit = 50, timeoutMs?: number): Promise<OwnershipChallenge[]> {
  return readWithTimeout("get_all_challenges", () => readContractValue<OwnershipChallenge[]>("get_all_challenges", [offset, limit]), timeoutMs);
}

/** Never report a write as successful from ACCEPTED alone. */
async function writeAndWait(functionName: string, args: unknown[]): Promise<{ hash: `0x${string}`; receipt: any }> {
  const client = getWriteClient();
  let hash: any;
  try {
    hash = await client.writeContract({
      address: addr(),
      functionName,
      args: args as any[],
      value: 0n,
    });
  } catch (error: any) {
    throw new Error(error?.shortMessage ?? error?.message ?? `Unable to submit ${functionName}`);
  }

  let receipt: any;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      interval: 2_500,
      retries: 120,
    });
  } catch (error: any) {
    throw new Error(`Transaction ${hash} did not reach FINALIZED: ${error?.shortMessage ?? error?.message ?? String(error)}`);
  }

  const statusName = receipt?.statusName ?? receipt?.status;
  if (statusName !== TransactionStatus.FINALIZED && statusName !== "FINALIZED") {
    throw new Error(`Transaction ${hash} ended in ${String(statusName)}; no finalized success was proven.`);
  }

  if (!isFinalizedSuccessfulReceipt(receipt)) {
    let detail = executionFailureDescription(receipt);
    try {
      const trace: any = await client.debugTraceTransaction({ hash });
      detail = trace?.stderr || trace?.genvm_log || trace?.error || detail;
    } catch {
      // The failed execution result is already sufficient to reject success.
    }
    throw new Error(`Transaction ${hash} finalized without successful execution: ${detail}`);
  }

  return { hash: hash as `0x${string}`, receipt };
}

export async function requestVerification(platform: string, username: string, profileUrl: string) {
  return writeAndWait("request_verification", [platform, username, profileUrl]);
}

export async function completeVerification(fetchUrl = "") {
  return writeAndWait("complete_verification", [fetchUrl]);
}

export async function reverifyPlatform(platform: string, username: string, fetchUrl = "") {
  return writeAndWait("reverify_platform", [platform, username, fetchUrl]);
}

export async function cancelPendingVerification() {
  return writeAndWait("cancel_pending_verification", []);
}

export async function revokePlatform(platform: string, username: string) {
  return writeAndWait("revoke_platform", [platform, username]);
}

export async function flagIdentity(target: string, reason: string) {
  return writeAndWait("flag_identity", [target, reason]);
}

export async function unflagIdentity(target: string) {
  return writeAndWait("unflag_identity", [target]);
}

export async function setDiscordAttestationBaseUrl(baseUrl: string) {
  return writeAndWait("set_discord_attestation_base_url", [baseUrl]);
}

export async function requestOwnershipChallenge(platform: string, username: string) {
  return writeAndWait("request_ownership_challenge", [platform, username]);
}

export async function submitChallengeEvidence(challengeId: string, evidenceUrl: string) {
  return writeAndWait("submit_challenge_evidence", [challengeId, evidenceUrl]);
}

export async function respondToChallenge(challengeId: string, evidenceUrl: string, statement: string) {
  return writeAndWait("respond_to_challenge", [challengeId, evidenceUrl, statement]);
}

export async function resolveOwnershipChallenge(challengeId: string) {
  return writeAndWait("resolve_ownership_challenge", [challengeId]);
}

export async function expireOwnershipChallenge(challengeId: string) {
  return writeAndWait("expire_ownership_challenge", [challengeId]);
}

export async function executeWalletRecovery(challengeId: string) {
  return writeAndWait("execute_wallet_recovery", [challengeId]);
}
