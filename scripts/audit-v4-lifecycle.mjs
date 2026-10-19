import fs from "node:fs";
import path from "node:path";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { config, repositoryRoot } from "./env_secrets.mjs";

const contractAddress = process.argv[2] || config("V4_TRUSTPASS_CONTRACT_ADDRESS");
const requestIds = process.argv.slice(3).filter(Boolean);
if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) throw new Error("V4_TRUSTPASS_CONTRACT_ADDRESS is required");
const client = createClient({ chain: studionet, endpoint: "https://studio.genlayer.com/api" });
const stats = await client.readContract({ address: contractAddress, functionName: "get_stats", args: [] });
const requests = [];
for (const requestId of requestIds) {
  const request = await client.readContract({ address: contractAddress, functionName: "get_request", args: [requestId] });
  requests.push({ requestId, status: request?.found === false ? "untested" : "confirmed_state_read", state: request?.state || null, paymentState: request?.payment_state || null, arcDeposit: request?.arc_tx_hash || null, arcSettlement: request?.arc_settlement_tx_hash || null, arcRefund: request?.arc_refund_tx_hash || null });
}
const evidence = {
  protocol: "SoulStamp V4 TrustPass & Sybil Gate",
  auditMode: "read_only_rpc",
  network: { name: "GenLayer Studionet", chainId: 61999, rpc: "https://studio.genlayer.com/api" },
  contractAddress,
  stats,
  requests,
  missingProofScenarios: [
    "No transaction hash is recorded unless supplied by a finalized receipt or contract request state.",
    "Google positive OAuth requires external Worker credentials and a real consenting account.",
    "Human Passport positive evidence requires a subject wallet with authentic on-chain evidence.",
    "Arc payment, settlement and refund records require actual Arc transactions.",
  ],
  generatedAt: new Date().toISOString(),
};
const outputPath = path.join(repositoryRoot(), "artifacts", "live", "v4-lifecycle-audit.json");
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, contractAddress, requestCount: requests.length, stats }, null, 2));

