import crypto from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  parseEventLogs,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { classifyReceipt, executionFailureDescription } from "./receipt_semantics.mjs";
import { config, requireSecret } from "./env_secrets.mjs";

const [requestId, genlayerTxHash] = process.argv.slice(2);
if (!requestId || !genlayerTxHash) throw new Error("usage: node scripts/settle-v4-payment.mjs <request-id> <finalized-genlayer-tx-hash>");

const V4 = config("V4_TRUSTPASS_CONTRACT_ADDRESS");
const ESCROW = config("ARC_ESCROW_ADDRESS");
if (!/^0x[0-9a-fA-F]{40}$/.test(V4) || !/^0x[0-9a-fA-F]{40}$/.test(ESCROW)) throw new Error("V4_TRUSTPASS_CONTRACT_ADDRESS and ARC_ESCROW_ADDRESS are required");

const genlayerPrivateKey = requireSecret("GENLAYER_PRIVATE_KEY", ["DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]);
const genlayerAccount = createAccount(genlayerPrivateKey);
const genlayer = createClient({ chain: studionet, endpoint: "https://studio.genlayer.com/api", account: genlayerAccount });
const receipt = await genlayer.waitForTransactionReceipt({ hash: genlayerTxHash, status: TransactionStatus.FINALIZED, interval: 2500, retries: 120 });
const classification = classifyReceipt(receipt);
if (!classification.successful) throw new Error(`GenLayer assessment transaction is not finalized with successful majority execution: ${executionFailureDescription(receipt)}`);
const request = await genlayer.readContract({ address: V4, functionName: "get_request", args: [requestId] });
if (!request || request.state !== "EVALUATED_PENDING_SETTLEMENT" || request.payment_state !== "ESCROWED") {
  throw new Error(`Request is not awaiting settlement: ${JSON.stringify(request)}`);
}
if (!request.assessment_id || !/^\w{64}$/.test(String(request.assessment_id))) throw new Error("Request has no valid assessment ID");
if (!request.arc_tx_hash) throw new Error("Request has no bound Arc deposit");

const ARC_CHAIN_ID = 5_042_002;
const ARC_RPC_URL = config("ARC_RPC_URL", "https://rpc.testnet.arc.io");
const arc = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
});
const operator = privateKeyToAccount(requireSecret("ARC_SETTLEMENT_OPERATOR_PRIVATE_KEY", ["ARC_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]));
const publicClient = createPublicClient({ chain: arc, transport: http(ARC_RPC_URL) });
const walletClient = createWalletClient({ account: operator, chain: arc, transport: http(ARC_RPC_URL) }).extend(publicActions);
if (await publicClient.getChainId() !== ARC_CHAIN_ID) throw new Error("Refusing a non-Arc settlement network");
const v4Stats = await genlayer.readContract({ address: V4, functionName: "get_stats", args: [] });
if (String(v4Stats.settlement_operator || "").toLowerCase() !== operator.address.toLowerCase()
  || String(v4Stats.settlement_operator || "").toLowerCase() !== genlayerAccount.address.toLowerCase()) {
  throw new Error("Arc settlement signer and GenLayer settlement signer must match the configured V4 operator");
}

const escrowAbi = parseAbi([
  "function settlementOperator() view returns (address)",
  "function getPayment(bytes32) view returns ((bytes32 requestId,address payer,address subject,bytes32 policyHash,uint256 amount,uint256 nonce,uint256 intentExpiry,uint256 depositedAt,uint8 status))",
  "function settle(bytes32 requestId, bytes32 assessmentId, address subject, bytes32 policyHash, uint8 outcome, bytes32 resultCommitment)",
  "event PaymentSettled(bytes32 indexed requestId, bytes32 indexed assessmentId, address indexed subject, bytes32 policyHash, uint8 outcome, bytes32 resultCommitment)",
]);
const configuredOperator = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "settlementOperator" });
if (configuredOperator.toLowerCase() !== operator.address.toLowerCase()) throw new Error("Settlement signer is not the configured Arc operator");

function sha256Hex(value) {
  return `0x${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function asBytes32(value, label) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is not bytes32`);
  return value;
}
const requestKey = asBytes32(String(request.request_key || sha256Hex(`SOULSTAMP-V4-REQUEST-ID:${requestId}`)), "request key");
const assessmentKey = asBytes32(sha256Hex(`SOULSTAMP-V4-REQUEST-ID:${String(request.assessment_id)}`), "assessment key");
const policyHash = asBytes32(String(request.policy_hash), "policy hash");
const outcome = { PASS: 1, FAIL: 2, INCONCLUSIVE: 3 }[String(request.proposed_outcome)];
if (!outcome) throw new Error("Request outcome is invalid");
const resultCommitment = asBytes32(sha256Hex(`SOULSTAMP-V4-RESULT:${requestId}:${request.assessment_id}:${request.proposed_outcome}:${request.policy_hash}`), "result commitment");
const payment = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getPayment", args: [requestKey] });
if (Number(payment.status) !== 1 || payment.subject.toLowerCase() !== String(request.subject).toLowerCase() || payment.policyHash.toLowerCase() !== policyHash.toLowerCase()) {
  throw new Error("Arc payment post-state does not match the GenLayer request");
}

const settlementHash = await walletClient.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "settle", args: [requestKey, assessmentKey, request.subject, policyHash, outcome, resultCommitment], account: operator, chain: arc });
const settlementReceipt = await publicClient.waitForTransactionReceipt({ hash: settlementHash, confirmations: 1 });
if (settlementReceipt.status !== "success") throw new Error(`Arc settlement reverted: ${settlementHash}`);
const events = parseEventLogs({ abi: escrowAbi, logs: settlementReceipt.logs, eventName: "PaymentSettled", strict: false });
if (events.length !== 1) throw new Error("Arc settlement receipt did not contain exactly one PaymentSettled event");
const logIndex = Number(events[0].logIndex ?? 0);
const v4SettlementHash = await genlayer.writeContract({
  account: genlayerAccount,
  address: V4,
  functionName: "settle_assessment",
  args: [requestId, settlementHash, logIndex],
  value: 0n,
});
const v4SettlementReceipt = await genlayer.waitForTransactionReceipt({
  hash: v4SettlementHash,
  status: TransactionStatus.FINALIZED,
  interval: 2500,
  retries: 120,
});
const v4Classification = classifyReceipt(v4SettlementReceipt);
if (!v4Classification.successful) throw new Error(`V4 settlement consumption failed: ${executionFailureDescription(v4SettlementReceipt)}`);
const postState = await genlayer.readContract({ address: V4, functionName: "get_request", args: [requestId] });
if (postState.payment_state !== "SETTLED" || !["ACTIVE", "COMPLETED_FAIL", "COMPLETED_INCONCLUSIVE"].includes(String(postState.state))) {
  throw new Error(`V4 settlement post-state is not consumable: ${JSON.stringify(postState)}`);
}
console.log(JSON.stringify({
  genlayer: { transaction: genlayerTxHash, status: classification.statusName, consensus: classification.rawResultName, execution: classification.txExecutionResultName, requestId },
  arc: { chainId: ARC_CHAIN_ID, escrow: ESCROW, transaction: settlementHash, explorer: `https://explorer.testnet.arc.io/tx/${settlementHash}`, logIndex, operator: operator.address },
  genlayerSettlement: { transaction: v4SettlementHash, explorer: `https://explorer-studio.genlayer.com/tx/${v4SettlementHash}`, status: v4Classification.statusName, consensus: v4Classification.rawResultName, execution: v4Classification.txExecutionResultName },
  binding: { requestKey, assessmentKey, subject: request.subject, policyHash, outcome: request.proposed_outcome, resultCommitment },
  postState: { state: postState.state, paymentState: postState.payment_state, assessmentId: postState.assessment_id },
}, null, 2));
