export const FINALIZED_STATUS = "FINALIZED";
export const SUCCESSFUL_EXECUTION = "FINISHED_WITH_RETURN";
export const FAILED_EXECUTION = "FINISHED_WITH_ERROR";
export const NOT_VOTED_EXECUTION = "NOT_VOTED";

const STATUS_NAMES = {
  7: FINALIZED_STATUS,
};

const CONSENSUS_RESULT_NAMES = {
  0: "IDLE",
  1: "AGREE",
  2: "DISAGREE",
  3: "TIMEOUT",
  4: "DETERMINISTIC_VIOLATION",
  5: "NO_MAJORITY",
  6: "MAJORITY_AGREE",
  7: "MAJORITY_DISAGREE",
};

const EXECUTION_RESULT_NAMES = {
  0: NOT_VOTED_EXECUTION,
  1: SUCCESSFUL_EXECUTION,
  2: FAILED_EXECUTION,
};

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function scalarValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    return scalarValue(value.name ?? value.resultName ?? value.result_name ?? value.value ?? value.result);
  }
  return value;
}

function firstValue(receipt, fields) {
  for (const field of fields) {
    const value = scalarValue(receipt?.[field]);
    if (value !== null) return value;
  }
  return null;
}

export function normalizedStatusName(receipt) {
  const value = firstValue(receipt, ["statusName", "status_name", "status"]);
  const numeric = numericValue(value);
  if (numeric !== null && STATUS_NAMES[numeric]) return STATUS_NAMES[numeric];
  return typeof value === "string" ? value.toUpperCase() : value;
}

export function normalizedConsensusResultName(receipt) {
  const value = firstValue(receipt, [
    "rawResultName",
    "resultName",
    "result_name",
    "consensusResultName",
    "consensus_result_name",
    "consensus_result",
    "result",
    "consensus_data",
  ]);
  const numeric = numericValue(value);
  if (numeric !== null && CONSENSUS_RESULT_NAMES[numeric]) return CONSENSUS_RESULT_NAMES[numeric];
  return typeof value === "string" ? value.toUpperCase() : value;
}

function normalizeExecutionValue(value) {
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

function directExecutionValue(receipt) {
  return firstValue(receipt, [
    "txExecutionResultName",
    "tx_execution_result_name",
    "txExecutionResult",
    "tx_execution_result",
  ]);
}

export function leaderReceiptEntries(receipt) {
  const entries = receipt?.consensus_data?.leader_receipt
    ?? receipt?.consensusData?.leaderReceipt
    ?? [];
  return Array.isArray(entries) ? entries : [];
}

export function rawLeaderExecutionResults(receipt) {
  return leaderReceiptEntries(receipt)
    .map((entry) => entry?.execution_result ?? entry?.executionResult)
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value));
}

/**
 * The SDK's documented authoritative field is txExecutionResultName. Some
 * current Studionet receipts omit that field and expose a leader receipt plus
 * secondary validator receipts instead. In that shape, only mode=leader is
 * authoritative for execution; validator entries cancelled after quorum are
 * not failed contract execution. Unlabelled legacy entries are accepted only
 * when they are uniformly successful, or uniformly expose a real error.
 */
export function authoritativeExecutionResult(receipt) {
  const direct = normalizeExecutionValue(directExecutionValue(receipt));
  if (direct !== null) return direct;

  const entries = leaderReceiptEntries(receipt);
  const leader = entries.find((entry) => String(entry?.mode ?? "").toLowerCase() === "leader");
  if (leader) return normalizeExecutionValue(leader.execution_result ?? leader.executionResult);

  if (entries.length > 0 && entries.every((entry) => entry?.mode === undefined || entry?.mode === null)) {
    const results = entries.map((entry) => normalizeExecutionValue(entry?.execution_result ?? entry?.executionResult));
    if (results.length > 0 && results.every((result) => result === SUCCESSFUL_EXECUTION)) return SUCCESSFUL_EXECUTION;
    if (results.some((result) => result === FAILED_EXECUTION)) return FAILED_EXECUTION;
  }
  return null;
}

export function hasMajorityAgreement(receipt) {
  return normalizedConsensusResultName(receipt) === "MAJORITY_AGREE";
}

export function classifyReceipt(receipt) {
  const statusName = normalizedStatusName(receipt);
  const rawResultName = normalizedConsensusResultName(receipt);
  const txExecutionResultName = authoritativeExecutionResult(receipt);
  return {
    statusName,
    rawResultName,
    txExecutionResultName,
    rawExecutionResults: rawLeaderExecutionResults(receipt),
    finalized: statusName === FINALIZED_STATUS,
    majorityAgreed: hasMajorityAgreement(receipt),
    successful: statusName === FINALIZED_STATUS
      && hasMajorityAgreement(receipt)
      && txExecutionResultName === SUCCESSFUL_EXECUTION,
  };
}

export function executionFailureDescription(receipt) {
  const direct = directExecutionValue(receipt);
  if (direct !== null) return String(direct);

  const entries = leaderReceiptEntries(receipt);
  const leader = entries.find((entry) => String(entry?.mode ?? "").toLowerCase() === "leader");
  if (leader) {
    const value = leader.execution_result ?? leader.executionResult;
    if (value !== undefined && value !== null) return `authoritative leader execution result: ${String(value)}`;
  }

  const results = rawLeaderExecutionResults(receipt);
  if (results.length > 0) return `leader execution results: ${results.join(", ")}`;
  return "execution result was not FINISHED_WITH_RETURN";
}
