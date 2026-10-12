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

  it("rejects an accepted transaction even when execution looks successful", () => {
    expect(isFinalizedSuccessfulReceipt({
      statusName: "ACCEPTED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
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
});
