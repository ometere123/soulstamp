import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authoritativeExecutionResult,
  classifyReceipt,
  executionFailureDescription,
} from "../../scripts/receipt_semantics.mjs";

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/finality_receipts.json", import.meta.url), "utf8"),
);

test("the mixed finalized request receipt uses the successful leader result", () => {
  const result = classifyReceipt(fixtures.mixed_finalized_request);
  assert.equal(result.statusName, "FINALIZED");
  assert.equal(result.rawResultName, "MAJORITY_AGREE");
  assert.equal(result.txExecutionResultName, "FINISHED_WITH_RETURN");
  assert.deepEqual(result.rawExecutionResults, ["SUCCESS", "ERROR"]);
  assert.equal(result.successful, true);
});

test("an explicit authoritative failure cannot be overridden by leader-receipt details", () => {
  assert.equal(authoritativeExecutionResult(fixtures.authoritative_failure), "FINISHED_WITH_ERROR");
  assert.equal(classifyReceipt(fixtures.authoritative_failure).successful, false);
});

test("Undetermined consensus and missing execution metadata fail closed", () => {
  assert.equal(classifyReceipt(fixtures.undetermined).successful, false);
  assert.equal(classifyReceipt(fixtures.missing_execution).successful, false);
});

test("legacy uniformly successful leader receipts remain supported", () => {
  assert.equal(classifyReceipt(fixtures.legacy_uniform_success).successful, true);
  assert.equal(
    executionFailureDescription({
      statusName: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
    }),
    "leader execution results: ERROR",
  );
});
