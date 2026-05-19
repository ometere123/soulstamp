import { readClient, getWriteClient, CONTRACT_ADDRESS } from "./client";
import type {
  IdentityRecord,
  PendingVerification,
  PlatformLookupResult,
  AuditEntry,
  PlatformStats,
} from "../types";

function addr(): `0x${string}` {
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");
  return CONTRACT_ADDRESS;
}

// ── Read helpers (use readClient — no wallet required) ───────────────────────

// readContract on Studionet sometimes hangs forever if the RPC chokes — we
// wrap every read in a hard 20s timeout + console log so we can see and
// recover from stuck calls.
async function readWithTimeout<T>(label: string, fn: () => Promise<T>, ms = 45_000): Promise<T> {
  console.log(`[soulstamp] 🔎 read ${label}…`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race<T>([
      fn(),
      new Promise<T>((_, rej) => {
        timeout = setTimeout(() => rej(new Error(`read ${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
    console.log(`[soulstamp] ✅ read ${label} →`, result);
    return result;
  } catch (e: any) {
    console.error(`[soulstamp] ❌ read ${label} failed:`, e?.message ?? e);
    throw e;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readContractValue<T>(functionName: string, args: unknown[] = []): Promise<T> {
  const result = await readClient.readContract({
    address: addr(),
    functionName,
    args: args as any[],
  });
  return result as unknown as T;
}

export async function getIdentity(address: string, timeoutMs?: number): Promise<IdentityRecord> {
  return readWithTimeout("get_identity", () => readContractValue<IdentityRecord>("get_identity", [address]), timeoutMs);
}

export async function getPendingVerification(address: string, timeoutMs?: number): Promise<PendingVerification> {
  return readWithTimeout("get_pending_verification", () => readContractValue<PendingVerification>("get_pending_verification", [address]), timeoutMs);
}

export async function lookupByPlatform(
  platform: string,
  username: string,
  timeoutMs?: number
): Promise<PlatformLookupResult> {
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

// ── Write helpers (use writeClient — wallet must be connected) ────────────────

// A transaction is "done" (result is final and state is queryable) once it
// reaches any of these states. We poll on statusName, which Studionet's
// getTransaction returns as a plain string — much more reliable than the
// numeric status check inside the SDK's waitForTransactionReceipt.
const DECIDED_STATES = new Set([
  "ACCEPTED",
  "UNDETERMINED",
  "FINALIZED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
  "CANCELED",
]);

async function waitAccepted(hash: `0x${string}`, timeoutMs = 180_000): Promise<any> {
  const interval = 2_500;
  const deadline = Date.now() + timeoutMs;
  let pollCount = 0;

  console.log(`[soulstamp] ⏳ Polling tx ${hash} for ACCEPTED…`);

  while (Date.now() < deadline) {
    pollCount++;
    try {
      const tx: any = await (readClient.getTransaction as any)({ hash });
      const name = tx?.statusName ?? tx?.status;
      console.log(`[soulstamp] poll #${pollCount} status=${name} (raw=`, tx?.status, ")");
      if (typeof name === "string" && DECIDED_STATES.has(name)) {
        console.log(`[soulstamp] ✅ tx finalised at status=${name}`);
        return tx;
      }
    } catch (e: any) {
      console.log(`[soulstamp] poll #${pollCount} getTransaction error:`, e?.message ?? e);
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for transaction ${hash} to be accepted (3 minutes)`);
}

/**
 * After a tx reaches a decided consensus state, inspect the actual execution
 * result. If the contract raised gl.vm.UserError (rollback), the tx reaches
 * ACCEPTED/FINALIZED but the state was never written. We must surface the
 * rollback reason as a real error, not let the UI pretend success.
 *
 * The tx object shape on Studionet (from decodeLocalnetTransaction):
 *   tx.consensus_data.leader_receipt[].result -> { Rollback: "msg" } | { Return: ... }
 * Field names vary between SDK versions, so we defensively check several.
 */
function extractRollbackReason(tx: any): string | null {
  if (!tx) return null;

  const asFailureReason = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    const text = String(value);
    if (/validator execution cancelled after quorum/i.test(text)) return null;
    return text;
  };

  // Field 1: top-level explicit error fields
  const topExec = tx.execution_result ?? tx.txExecutionResult;
  if (typeof topExec === "string" && /error|rollback|fail/i.test(topExec)) {
    // we'll keep looking for a message below; the string alone isn't useful
  }

  // Field 2: leader_receipt may be a single object or an array
  const lr = tx.consensus_data?.leader_receipt;
  if (lr) {
    const receipts = Array.isArray(lr) ? lr : [lr];
    for (const r of receipts) {
      const result = r?.result;
      // Decoded shape: { Rollback: "message" }
      if (result && typeof result === "object" && "Rollback" in result) {
        const reason = asFailureReason(result.Rollback);
        if (reason) return reason;
        continue;
      }
      // Or sometimes: { rollback: { message: "..." } } / similar
      if (result?.rollback) {
        const reason = asFailureReason(result.rollback.message ?? result.rollback);
        if (reason) return reason;
        continue;
      }
      // Studionet currently decodes UserError rollbacks like:
      // { status: "rollback", payload: "human-readable reason", raw: "..." }
      if (result && typeof result === "object" && String(result.status ?? "").toLowerCase() === "rollback") {
        const reason = asFailureReason(result.payload ?? result.reason ?? result.message ?? "Contract reverted");
        if (reason) return reason;
        continue;
      }
      // Or just a plain string starting with "Error" / "Rollback"
      if (typeof result === "string" && /^(rollback|error)/i.test(result)) {
        const reason = asFailureReason(result);
        if (reason) return reason;
        continue;
      }
      // execution_result on the receipt itself
      if (typeof r?.execution_result === "string" && /error|rollback/i.test(r.execution_result)) {
        const reason = asFailureReason(
          r.reason ??
          r.error?.message ??
          r.error ??
          r.message ??
          r.genvm_result?.error_description ??
          r.genvm_result?.stderr ??
          r.execution_result
        );
        if (reason) return reason;
      }
    }
  }

  // Field 3: direct error/reason on tx
  if (tx.error) {
    const reason = asFailureReason(tx.error.message ?? tx.error);
    if (reason) return reason;
  }
  if (tx.reason && /error|rollback/i.test(String(topExec ?? ""))) {
    const reason = asFailureReason(tx.reason);
    if (reason) return reason;
  }

  return null;
}

async function writeAndWait(
  functionName: string,
  args: unknown[]
): Promise<any> {
  const client = getWriteClient();
  console.log(`[soulstamp] 📝 writeContract(${functionName}) args=`, args);
  let hash: `0x${string}`;
  try {
    hash = await client.writeContract({
      address: addr(),
      functionName,
      args: args as any[],
      value: 0n,
    });
    console.log(`[soulstamp] ✍️  signed → hash=${hash}`);
  } catch (e: any) {
    console.error(`[soulstamp] ❌ writeContract(${functionName}) failed:`, e);
    throw e;
  }

  const tx = await waitAccepted(hash);

  // Inspect the actual execution result — consensus alone is not success.
  console.log(`[soulstamp] 🔬 inspecting tx for rollback…`, tx);
  const rollback = extractRollbackReason(tx);
  if (rollback) {
    console.error(`[soulstamp] ⛔ contract reverted: ${rollback}`);
    throw new Error(rollback);
  }
  console.log(`[soulstamp] 🎉 ${functionName} succeeded on-chain`);
  return tx;
}

export async function requestVerification(
  platform: string,
  username: string,
  profileUrl: string
): Promise<void> {
  await writeAndWait("request_verification", [platform, username, profileUrl]);
}

export async function completeVerification(fetchUrl: string = ""): Promise<void> {
  await writeAndWait("complete_verification", [fetchUrl]);
}

export async function cancelPendingVerification(): Promise<void> {
  await writeAndWait("cancel_pending_verification", []);
}

export async function revokePlatform(platform: string, username: string): Promise<void> {
  await writeAndWait("revoke_platform", [platform, username]);
}

export async function flagIdentity(target: string, reason: string): Promise<void> {
  await writeAndWait("flag_identity", [target, reason]);
}

export async function unflagIdentity(target: string): Promise<void> {
  await writeAndWait("unflag_identity", [target]);
}

export async function setDiscordAttestationBaseUrl(baseUrl: string): Promise<void> {
  await writeAndWait("set_discord_attestation_base_url", [baseUrl]);
}
