import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const [hash, rpc = "https://studio.genlayer.com/api"] = process.argv.slice(2);
if (!hash) throw new Error("usage: node scripts/finalized_tx.mjs <tx-hash> [rpc]");

const client = createClient({ chain: studionet, endpoint: rpc });
const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 2500,
  retries: 120,
});

// Older SDK receipts expose txExecutionResultName. Current Studionet receipts
// expose status_name and consensus_data.leader_receipt instead. Normalize both
// shapes so FINALIZED is never confused with execution success.
const statusName = receipt.statusName ?? receipt.status_name ?? receipt.status;
const directExecutionName = receipt.txExecutionResultName ?? receipt.tx_execution_result_name;
const leaderReceipts = receipt.consensus_data?.leader_receipt ?? receipt.consensusData?.leaderReceipt ?? [];
const leaderExecutionResults = leaderReceipts
  .map((entry) => entry.execution_result ?? entry.executionResult)
  .filter((value) => value !== undefined && value !== null);
const hasCurrentSuccess = leaderExecutionResults.length > 0 && leaderExecutionResults.every((value) => value === "SUCCESS");
const hasCurrentFailure = leaderExecutionResults.some((value) => value !== "SUCCESS");
const executionName = directExecutionName
  ?? (hasCurrentSuccess ? ExecutionResult.FINISHED_WITH_RETURN : hasCurrentFailure ? ExecutionResult.FINISHED_WITH_ERROR : null);
const result = {
  hash,
  statusName,
  txExecutionResultName: executionName,
  rawResultName: receipt.resultName ?? receipt.result_name ?? null,
  rawExecutionResults: leaderExecutionResults,
  contractAddress: receipt.data?.contract_address ?? receipt.txDataDecoded?.contractAddress ?? null,
};
console.log(JSON.stringify(result));
if (statusName !== TransactionStatus.FINALIZED && statusName !== "FINALIZED") process.exitCode = 2;
if (executionName !== ExecutionResult.FINISHED_WITH_RETURN && executionName !== "FINISHED_WITH_RETURN") process.exitCode = 3;
