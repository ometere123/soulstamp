export const FINALIZED_STATUS = "FINALIZED";
export const SUCCESSFUL_EXECUTION = "FINISHED_WITH_RETURN";

export function isFinalizedSuccessfulReceipt(receipt: any): boolean {
  const status = receipt?.statusName ?? receipt?.status;
  const execution = receipt?.txExecutionResultName;
  return (status === FINALIZED_STATUS || status === "FINALIZED")
    && (execution === SUCCESSFUL_EXECUTION || execution === "FINISHED_WITH_RETURN");
}

export function executionFailureDescription(receipt: any): string {
  return String(receipt?.txExecutionResultName ?? "execution result was not FINISHED_WITH_RETURN");
}
