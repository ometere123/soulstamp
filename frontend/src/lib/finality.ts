export const FINALIZED_STATUS = "FINALIZED";
export const SUCCESSFUL_EXECUTION = "FINISHED_WITH_RETURN";
export const FAILED_EXECUTION = "FINISHED_WITH_ERROR";
export const NOT_VOTED_EXECUTION = "NOT_VOTED";

const CONSENSUS_RESULT_NAMES: Record<number, string> = {
  0: "IDLE",
  1: "AGREE",
  2: "DISAGREE",
  3: "TIMEOUT",
  4: "DETERMINISTIC_VIOLATION",
  5: "NO_MAJORITY",
  6: "MAJORITY_AGREE",
  7: "MAJORITY_DISAGREE",
};

const EXECUTION_RESULT_NAMES: Record<number, string> = {
  0: NOT_VOTED_EXECUTION,
  1: SUCCESSFUL_EXECUTION,
  2: FAILED_EXECUTION,
};

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function scalarValue(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return scalarValue(object.name ?? object.resultName ?? object.result_name ?? object.value ?? object.result);
  }
  return value;
}

function firstValue(receipt: any, fields: string[]): unknown {
  for (const field of fields) {
    const value = scalarValue(receipt?.[field]);
    if (value !== null) return value;
  }
  return null;
}

export function normalizedStatusName(receipt: any): string | number | null {
  const value = firstValue(receipt, ["statusName", "status_name", "status"]);
  const numeric = numericValue(value);
  if (numeric !== null && numeric === 7) return FINALIZED_STATUS;
  return typeof value === "string" ? value.toUpperCase() : (value as string | number | null);
}

export function consensusResultName(receipt: any): string | number | null {
  const value = firstValue(receipt, [
    "rawResultName",
    "resultName",
    "result_name",
    "consensusResultName",
    "consensus_result_name",
    "consensus_result",
    "result",
  ]);
  const numeric = numericValue(value);
  if (numeric !== null && CONSENSUS_RESULT_NAMES[numeric]) return CONSENSUS_RESULT_NAMES[numeric];
  return typeof value === "string" ? value.toUpperCase() : (value as string | number | null);
}

function normalizeExecutionValue(value: unknown): string | null {
  const scalar = scalarValue(value);
  if (scalar === null) return null;
  const numeric = numericValue(scalar);
  if (numeric !== null && EXECUTION_RESULT_NAMES[numeric]) return EXECUTION_RESULT_NAMES[numeric];
  const normalized = String(scalar).trim().toUpperCase();
  if (["SUCCESS", "RETURN", "RETURNED", SUCCESSFUL_EXECUTION].includes(normalized)) return SUCCESSFUL_EXECUTION;
  if (["ERROR", "FAILED", "FAILURE", "CONTRACT_ERROR", FAILED_EXECUTION].includes(normalized)) return FAILED_EXECUTION;
  if (["IDLE", NOT_VOTED_EXECUTION].includes(normalized)) return NOT_VOTED_EXECUTION;
  return null;
}

function directExecutionValue(receipt: any): unknown {
  return firstValue(receipt, [
    "txExecutionResultName",
    "tx_execution_result_name",
    "txExecutionResult",
    "tx_execution_result",
  ]);
}

export function leaderReceiptEntries(receipt: any): any[] {
  const entries = receipt?.consensus_data?.leader_receipt
    ?? receipt?.consensusData?.leaderReceipt
    ?? [];
  return Array.isArray(entries) ? entries : [];
}

export function rawLeaderExecutionResults(receipt: any): string[] {
  return leaderReceiptEntries(receipt)
    .map(entry => entry?.execution_result ?? entry?.executionResult)
    .filter((value): value is string | number => value !== undefined && value !== null)
    .map(value => String(value));
}

/**
 * The SDK's top-level execution result is authoritative when present. Current
 * Studionet receipts can omit it and expose a leader plus secondary validator
 * entries. In that shape, only mode=leader determines contract execution;
 * validator entries cancelled after quorum must not turn a successful write
 * into a client-side failure.
 */
export function authoritativeExecutionResult(receipt: any): string | null {
  const direct = normalizeExecutionValue(directExecutionValue(receipt));
  if (direct !== null) return direct;

  const entries = leaderReceiptEntries(receipt);
  const leader = entries.find(entry => String(entry?.mode ?? "").toLowerCase() === "leader");
  if (leader) return normalizeExecutionValue(leader.execution_result ?? leader.executionResult);

  if (entries.length > 0 && entries.every(entry => entry?.mode === undefined || entry?.mode === null)) {
    const results = entries.map(entry => normalizeExecutionValue(entry?.execution_result ?? entry?.executionResult));
    if (results.length > 0 && results.every(result => result === SUCCESSFUL_EXECUTION)) return SUCCESSFUL_EXECUTION;
    if (results.some(result => result === FAILED_EXECUTION)) return FAILED_EXECUTION;
  }
  return null;
}

export function isFinalizedSuccessfulReceipt(receipt: any): boolean {
  return normalizedStatusName(receipt) === FINALIZED_STATUS
    && consensusResultName(receipt) === "MAJORITY_AGREE"
    && authoritativeExecutionResult(receipt) === SUCCESSFUL_EXECUTION;
}

export function executionFailureDescription(receipt: any): string {
  const direct = directExecutionValue(receipt);
  if (direct !== null) return String(direct);

  const entries = leaderReceiptEntries(receipt);
  const leader = entries.find(entry => String(entry?.mode ?? "").toLowerCase() === "leader");
  if (leader) {
    const value = leader.execution_result ?? leader.executionResult;
    if (value !== undefined && value !== null) return `authoritative leader execution result: ${String(value)}`;
  }

  const results = rawLeaderExecutionResults(receipt);
  if (results.length > 0) return `leader execution results: ${results.join(", ")}`;
  return "execution result was not FINISHED_WITH_RETURN";
}
