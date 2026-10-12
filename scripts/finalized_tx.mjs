import { abi, createClient } from "genlayer-js";
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
const resultValue = receipt.resultName ?? receipt.result_name ?? receipt.result ?? null;
const consensusResultNames = {
  0: "IDLE",
  1: "AGREE",
  2: "DISAGREE",
  3: "TIMEOUT",
  4: "DETERMINISTIC_VIOLATION",
  5: "NO_MAJORITY",
  6: "MAJORITY_AGREE",
  7: "MAJORITY_DISAGREE",
};
const numericResult = typeof resultValue === "number"
  ? resultValue
  : typeof resultValue === "bigint"
    ? Number(resultValue)
    : typeof resultValue === "string" && /^\d+$/.test(resultValue)
      ? Number(resultValue)
      : null;
const consensusResultName = numericResult !== null
  ? consensusResultNames[numericResult] ?? null
  : resultValue;

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [key, jsonSafe(item)]));
  if (value && typeof value === "object" && value.bytes instanceof Uint8Array) {
    return `0x${Buffer.from(value.bytes).toString("hex")}`;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

function decodeCallMetadata(transaction) {
  const calldata = transaction?.data?.calldata;
  const raw = Array.isArray(calldata?.raw)
    ? Uint8Array.from(calldata.raw)
    : typeof calldata === "string"
      ? Uint8Array.from(Buffer.from(calldata, "base64"))
      : null;
  if (!raw) return { method: null, args: [], decoded: false };
  try {
    const decoded = abi.calldata.decode(raw);
    const method = decoded instanceof Map ? decoded.get("method") : null;
    const args = decoded instanceof Map ? decoded.get("args") : [];
    return { method: method ?? null, args: jsonSafe(args ?? []), decoded: true };
  } catch (error) {
    return { method: null, args: [], decoded: false, decodeError: String(error) };
  }
}

const metadata = decodeCallMetadata(receipt);
const result = {
  hash,
  statusName,
  txExecutionResultName: executionName,
  rawResultName: consensusResultName,
  rawExecutionResults: leaderExecutionResults,
  contractAddress: receipt.data?.contract_address ?? receipt.txDataDecoded?.contractAddress ?? null,
  sender: receipt.from_address ?? receipt.origin_address ?? receipt.sender ?? null,
  recipient: receipt.to_address ?? receipt.recipient ?? null,
  transactionType: metadata.method ? "call" : receipt.data?.contract_code ? "deploy" : "unknown",
  method: metadata.method,
  args: metadata.args,
  calldataDecoded: metadata.decoded,
};
console.log(JSON.stringify(result));
if (statusName !== TransactionStatus.FINALIZED && statusName !== "FINALIZED") process.exitCode = 2;
if (executionName !== ExecutionResult.FINISHED_WITH_RETURN && executionName !== "FINISHED_WITH_RETURN") process.exitCode = 3;
if (consensusResultName !== "MAJORITY_AGREE" && consensusResultName !== 6) process.exitCode = 4;
