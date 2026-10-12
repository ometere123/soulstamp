import { describe, expect, it } from "vitest";
import {
  executionFailureDescription,
  isFinalizedSuccessfulReceipt,
} from "../../frontend/src/lib/finality";

describe("frontend transaction finality gate", () => {
  it("accepts only finalized successful execution", () => {
    expect(isFinalizedSuccessfulReceipt({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    })).toBe(true);
  });

  it("accepts the current Studionet leader-receipt shape only when every leader succeeds", () => {
    expect(isFinalizedSuccessfulReceipt({
      status_name: "FINALIZED",
      consensus_data: {
        leader_receipt: [
          { execution_result: "SUCCESS" },
          { execution_result: "SUCCESS" },
        ],
      },
    })).toBe(true);
    expect(isFinalizedSuccessfulReceipt({
      status_name: "FINALIZED",
      consensus_data: {
        leader_receipt: [
          { execution_result: "SUCCESS" },
          { execution_result: "ERROR" },
        ],
      },
    })).toBe(false);
  });

  it("rejects an accepted transaction even when execution looks successful", () => {
    expect(isFinalizedSuccessfulReceipt({
      statusName: "ACCEPTED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    })).toBe(false);
  });

  it("rejects finalized Undetermined consensus even when the leader execution succeeded", () => {
    expect(isFinalizedSuccessfulReceipt({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      resultName: "Undetermined",
      consensus_data: {
        leader_receipt: [{ execution_result: "SUCCESS" }],
      },
    })).toBe(false);
  });

  it("rejects finalized majority disagreement even when every leader receipt says SUCCESS", () => {
    expect(isFinalizedSuccessfulReceipt({
      statusName: "FINALIZED",
      rawResultName: "MAJORITY_DISAGREE",
      consensus_data: {
        leader_receipt: [
          { execution_result: "SUCCESS" },
          { execution_result: "SUCCESS" },
        ],
      },
    })).toBe(false);
  });

  it("rejects finalized execution failures", () => {
    const receipt = {
      statusName: "FINALIZED",
      txExecutionResultName: "FAILED",
    };
    expect(isFinalizedSuccessfulReceipt(receipt)).toBe(false);
    expect(executionFailureDescription(receipt)).toBe("FAILED");
  });

  it("describes a current-shape leader failure", () => {
    expect(executionFailureDescription({
      status_name: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
    })).toBe("leader execution results: ERROR");
  });
});
