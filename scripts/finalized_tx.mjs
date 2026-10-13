import { abi, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import {
  classifyReceipt,
  executionFailureDescription,
} from "./receipt_semantics.mjs";

const [hash, rpc = "https://studio.genlayer.com/api"] = process.argv.slice(2);
if (!hash) throw new Error("usage: node scripts/finalized_tx.mjs <tx-hash> [rpc]");

const client = createClient({ chain: studionet, endpoint: rpc });
const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 2500,
  retries: 120,
});

const classification = classifyReceipt(receipt);

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
  if (!raw) {
    const readable = calldata?.readable;
    if (typeof readable !== "string") return { method: null, args: [], decoded: false };
    const method = readable.match(/"method"\s*:\s*"([^"]+)"/)?.[1] ?? null;
    const argsText = readable.match(/"args"\s*:\s*\[(.*?)\]\s*"method"/s)?.[1] ?? "";
    const args = [...argsText.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => {
      try { return JSON.parse(`"${match[1]}"`); } catch { return match[1]; }
    });
    return { method, args, decoded: Boolean(method), source: "readable" };
  }
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
  statusName: classification.statusName,
  txExecutionResultName: classification.txExecutionResultName,
  rawResultName: classification.rawResultName,
  rawExecutionResults: classification.rawExecutionResults,
  authoritativeExecutionResult: classification.txExecutionResultName,
  contractAddress: receipt.data?.contract_address ?? receipt.txDataDecoded?.contractAddress ?? null,
  sender: receipt.from_address ?? receipt.origin_address ?? receipt.sender ?? null,
  recipient: receipt.to_address ?? receipt.recipient ?? null,
  transactionType: metadata.method ? "call" : receipt.data?.contract_code ? "deploy" : "unknown",
  method: metadata.method,
  args: metadata.args,
  calldataDecoded: metadata.decoded,
};
console.log(JSON.stringify(result));
if (!classification.finalized) {
  process.exitCode = 2;
} else if (!classification.majorityAgreed) {
  console.error(`consensus result: ${String(classification.rawResultName ?? "missing")}`);
  process.exitCode = 4;
} else if (classification.txExecutionResultName !== "FINISHED_WITH_RETURN") {
  console.error(executionFailureDescription(receipt));
  process.exitCode = 3;
}
