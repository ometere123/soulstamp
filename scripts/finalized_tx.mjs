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
const statusName = receipt.statusName ?? receipt.status;
const executionName = receipt.txExecutionResultName;
let trace = null;
if (executionName !== ExecutionResult.FINISHED_WITH_RETURN && executionName !== "FINISHED_WITH_RETURN") {
  trace = await client.debugTraceTransaction({ hash }).catch(() => null);
}
const result = {
  hash,
  statusName,
  txExecutionResultName: executionName,
  contractAddress: receipt.data?.contract_address ?? receipt.txDataDecoded?.contractAddress ?? null,
  trace,
};
console.log(JSON.stringify(result));
if (statusName !== TransactionStatus.FINALIZED && statusName !== "FINALIZED") process.exitCode = 2;
if (executionName !== ExecutionResult.FINISHED_WITH_RETURN && executionName !== "FINISHED_WITH_RETURN") process.exitCode = 3;
