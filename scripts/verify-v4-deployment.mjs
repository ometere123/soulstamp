import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { classifyReceipt, executionFailureDescription } from "./receipt_semantics.mjs";
import { config, repositoryRoot } from "./env_secrets.mjs";

const [address, txHash, sourceArg] = process.argv.slice(2);
const contractAddress = address || config("V4_TRUSTPASS_CONTRACT_ADDRESS");
const deploymentTx = txHash || config("V4_DEPLOYMENT_TRANSACTION");
const sourcePath = sourceArg || path.join(repositoryRoot(), "contracts", "soulstamp_trustpass.py");
const expectedSourceHash = config("V4_EXPECTED_SOURCE_SHA256");
if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) throw new Error("V4 contract address is required");
if (!/^0x[0-9a-fA-F]{64}$/.test(deploymentTx)) throw new Error("V4 deployment transaction is required");
if (!fs.existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);

function normalizeSource(value) {
  return String(value).replace(/\r\n?/g, "\n");
}
function hashSource(value) {
  return crypto.createHash("sha256").update(normalizeSource(value), "utf8").digest("hex");
}
function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

const client = createClient({ chain: studionet, endpoint: "https://studio.genlayer.com/api" });
const receipt = await client.waitForTransactionReceipt({
  hash: deploymentTx,
  status: TransactionStatus.FINALIZED,
  interval: 2500,
  retries: 120,
});
const classification = classifyReceipt(receipt);
if (!classification.finalized || !classification.majorityAgreed || !classification.successful) {
  throw new Error(`V4 deployment did not pass finality/execution gates: ${executionFailureDescription(receipt)}`);
}
const deployedAddress = String(receipt.data?.contract_address || receipt.contract_address || "").toLowerCase();
if (deployedAddress && deployedAddress !== contractAddress.toLowerCase()) throw new Error("Deployment receipt contract address mismatch");

const localSource = fs.readFileSync(sourcePath, "utf8");
const remoteSource = await client.getContractCode(contractAddress);
const localHash = hashSource(localSource);
const remoteHash = hashSource(remoteSource);
if (localHash !== remoteHash) throw new Error(`Deployed source parity failed: local ${localHash}, remote ${remoteHash}`);
if (expectedSourceHash && expectedSourceHash.toLowerCase() !== localHash) throw new Error(`Expected source hash mismatch: ${expectedSourceHash} vs ${localHash}`);

const stats = jsonSafe(await client.readContract({ address: contractAddress, functionName: "get_stats", args: [] }));
const expectedAdmin = config("V4_ADMIN_ADDRESS", "").toLowerCase();
if (stats.contract_version !== "soulstamp-v4.0-trustpass-sybil-gate") throw new Error("V4 contract version mismatch");
if (stats.v3_contract_address?.toLowerCase() !== config("V3_SOULSTAMP_CONTRACT_ADDRESS", "0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d").toLowerCase()) throw new Error("V3 linkage mismatch");
if (expectedAdmin && stats.admin?.toLowerCase() !== expectedAdmin) throw new Error("V4 admin mismatch");
for (const field of ["total_policies", "total_requests", "total_assessments", "total_passes", "total_settlements", "total_refunds"]) {
  if (String(stats[field]) !== "0") throw new Error(`Initial state field ${field} is not zero`);
}

console.log(JSON.stringify({
  network: "GenLayer Studionet",
  chainId: 61999,
  contractAddress,
  deploymentTransaction: deploymentTx,
  explorer: `https://explorer-studio.genlayer.com/tx/${deploymentTx}`,
  finality: {
    status: classification.statusName,
    consensus: classification.rawResultName,
    execution: classification.txExecutionResultName,
    rawExecutionResults: classification.rawExecutionResults,
  },
  sourceParity: {
    exactAfterLineEndingNormalization: true,
    localSha256: localHash,
    remoteSha256: remoteHash,
  },
  initialState: stats,
}, null, 2));

