export const FINALIZED_STATUS = "FINALIZED";
export const SUCCESSFUL_EXECUTION = "FINISHED_WITH_RETURN";

const MAJORITY_AGREE = "MAJORITY_AGREE";

function consensusResultName(receipt: any): string | number | null {
  const value = receipt?.rawResultName
    ?? receipt?.resultName
    ?? receipt?.result_name
    ?? receipt?.consensusResultName
    ?? receipt?.consensus_result_name
    ?? receipt?.consensus_result
    ?? receipt?.result
    ?? receipt?.consensus_data?.result
    ?? receipt?.consensus_data?.result_name
    ?? receipt?.consensus_data?.resultName;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    return value?.name ?? value?.resultName ?? value?.result_name ?? value?.value ?? value?.result ?? null;
  }
  return value;
}

/**
 * A leader can execute successfully while validator consensus rejects the
 * transaction. Treat an explicitly reported consensus result as authoritative
 * and never let Undetermined/Disagree/No-majority reach the UI as success.
 */
function hasMajorityAgreement(receipt: any): boolean {
  const result = consensusResultName(receipt);
  if (result === null) return true;
  return result === MAJORITY_AGREE || result === 6 || result === "6";
}

function currentLeaderExecutionResults(receipt: any): string[] {
  const leaders = receipt?.consensus_data?.leader_receipt
    ?? receipt?.consensusData?.leaderReceipt
    ?? [];
  if (!Array.isArray(leaders)) return [];
  return leaders
    .map((entry: any) => entry?.execution_result ?? entry?.executionResult)
    .filter((value: unknown): value is string => typeof value === "string");
}

export function isFinalizedSuccessfulReceipt(receipt: any): boolean {
  const status = receipt?.statusName ?? receipt?.status_name ?? receipt?.status;
  const execution = receipt?.txExecutionResultName ?? receipt?.tx_execution_result_name;
  if (status !== FINALIZED_STATUS && status !== "FINALIZED") return false;
  if (!hasMajorityAgreement(receipt)) return false;
  if (execution === SUCCESSFUL_EXECUTION || execution === "FINISHED_WITH_RETURN") return true;

  // Current Studionet receipts expose execution success per leader instead of
  // the legacy top-level txExecutionResultName field. Every leader must have
  // completed successfully before the UI can report a finalized write.
  const leaderResults = currentLeaderExecutionResults(receipt);
  return leaderResults.length > 0 && leaderResults.every(result => result === "SUCCESS");
}

export function executionFailureDescription(receipt: any): string {
  const execution = receipt?.txExecutionResultName ?? receipt?.tx_execution_result_name;
  if (execution) return String(execution);
  const leaderResults = currentLeaderExecutionResults(receipt);
  if (leaderResults.length > 0) return `leader execution results: ${leaderResults.join(", ")}`;
  return "execution result was not FINISHED_WITH_RETURN";
}
