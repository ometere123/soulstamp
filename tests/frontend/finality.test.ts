import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/finality_receipts.json";
import {
  authoritativeExecutionResult,
  executionFailureDescription,
  isFinalizedSuccessfulReceipt,
} from "../../frontend/src/lib/finality";

describe("frontend transaction finality gate", () => {
  it("accepts only finalized successful execution", () => {
    expect(isFinalizedSuccessfulReceipt({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      rawResultName: "MAJORITY_AGREE",
    })).toBe(true);
  });

  it("accepts the exact mixed Studionet receipt when the authoritative leader succeeded", () => {
    expect(authoritativeExecutionResult(fixtures.mixed_finalized_request)).toBe("FINISHED_WITH_RETURN");
    expect(isFinalizedSuccessfulReceipt(fixtures.mixed_finalized_request)).toBe(true);
  });

  it("does not let an explicitly failed authoritative execution be overridden", () => {
    expect(authoritativeExecutionResult(fixtures.authoritative_failure)).toBe("FINISHED_WITH_ERROR");
    expect(isFinalizedSuccessfulReceipt(fixtures.authoritative_failure)).toBe(false);
  });

  it("rejects an Undetermined consensus despite a successful leader", () => {
    expect(isFinalizedSuccessfulReceipt(fixtures.undetermined)).toBe(false);
  });

  it("keeps the legacy uniform leader-receipt fallback", () => {
    expect(isFinalizedSuccessfulReceipt(fixtures.legacy_uniform_success)).toBe(true);
  });

  it("fails closed when execution metadata is missing", () => {
    expect(isFinalizedSuccessfulReceipt(fixtures.missing_execution)).toBe(false);
  });

  it("rejects an accepted transaction even when execution looks successful", () => {
    expect(isFinalizedSuccessfulReceipt({
      statusName: "ACCEPTED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    })).toBe(false);
  });

  it("rejects finalized success when majority consensus metadata is absent", () => {
    expect(isFinalizedSuccessfulReceipt({
      statusName: "FINALIZED",
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
