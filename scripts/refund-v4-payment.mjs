import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
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
import { classifyReceipt, executionFailureDescription } from "./receipt_semantics.mjs";
import { config, requireSecret } from "./env_secrets.mjs";

const [requestId, requestKey, v4Address, escrowAddress, expectedPayer] = process.argv.slice(2);
if (!requestId || !/^0x[0-9a-fA-F]{64}$/.test(requestKey || "") || !/^0x[0-9a-fA-F]{40}$/.test(v4Address || "") || !/^0x[0-9a-fA-F]{40}$/.test(escrowAddress || "") || !/^0x[0-9a-fA-F]{40}$/.test(expectedPayer || "")) {
  throw new Error("usage: node scripts/refund-v4-payment.mjs <request-id> <bytes32-request-key> <historical-v4-address> <historical-arc-escrow-address> <expected-payer-address>");
}
// These addresses are deliberately command-line arguments for the historical
// refund path.  A current .env address must never silently redirect a refund
// or its GenLayer confirmation to a different V4/escrow pair.
const V4 = v4Address;
const ESCROW = escrowAddress;
const EXPECTED_PAYER = expectedPayer.toLowerCase();

const chainId = 5_042_002;
const rpc = config("ARC_RPC_URL", "https://rpc.testnet.arc.io");
const chain = defineChain({ id: chainId, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const account = privateKeyToAccount(requireSecret("ARC_REFUND_PRIVATE_KEY", ["ARC_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]));
const genlayerAccount = createAccount(requireSecret("GENLAYER_PRIVATE_KEY", ["DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]));
const genlayer = createClient({ chain: studionet, endpoint: "https://studio.genlayer.com/api", account: genlayerAccount });
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain, transport: http(rpc) }).extend(publicActions);
if (await publicClient.getChainId() !== chainId) throw new Error("Refusing a non-Arc network");

const escrowAbi = parseAbi([
  "function getPayment(bytes32) view returns ((bytes32 requestId,address payer,address subject,bytes32 policyHash,uint256 amount,uint256 nonce,uint256 intentExpiry,uint256 depositedAt,uint8 status))",
  "function refund(bytes32 requestId)",
  "event PaymentRefunded(bytes32 indexed requestId,address indexed payer,address indexed subject,uint256 amount)",
]);
const v4Request = await genlayer.readContract({ address: V4, functionName: "get_request", args: [requestId] });
if (String(v4Request.request_id || "") !== requestId) throw new Error("Historical V4 request ID does not match the supplied request");
if (String(v4Request.payment_state || "") !== "ESCROWED") throw new Error(`Historical V4 request is not escrowed; state ${String(v4Request.payment_state || "unknown")}`);
const intent = await genlayer.readContract({ address: V4, functionName: "get_payment_intent", args: [requestId] });
if (String(intent.request_key || "").toLowerCase() !== requestKey.toLowerCase()) throw new Error("Historical V4 payment intent does not match the supplied Arc request key");
if (String(intent.escrow || "").toLowerCase() !== ESCROW.toLowerCase()) throw new Error("Historical V4 payment intent is bound to a different Arc escrow");
if (String(intent.payer || "").toLowerCase() !== EXPECTED_PAYER) throw new Error("Historical V4 payment intent payer does not match the explicit expected payer");
const payment = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getPayment", args: [requestKey] });
if (String(payment.requestId).toLowerCase() !== requestKey.toLowerCase()) throw new Error("Arc escrow returned a payment for a different request key");
if (Number(payment.status) !== 1) throw new Error(`Payment is not escrowed; status ${payment.status}`);
if (String(payment.payer).toLowerCase() !== EXPECTED_PAYER) throw new Error("Arc escrow payer does not match the explicit expected payer");
if (account.address.toLowerCase() !== EXPECTED_PAYER) throw new Error("Refund signer must be the explicit original payer");
const refundAvailableAt = Number(payment.depositedAt) + 72 * 60 * 60;
if (!Number.isSafeInteger(refundAvailableAt)) throw new Error("Escrow depositedAt is outside the safe timestamp range");
if (Math.floor(Date.now() / 1000) < refundAvailableAt) throw new Error(`Refund is not eligible until ${new Date(refundAvailableAt * 1000).toISOString()}`);
const hash = await walletClient.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "refund", args: [requestKey], account, chain });
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (receipt.status !== "success") throw new Error(`Refund reverted: ${hash}`);
const events = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "PaymentRefunded", strict: false });
if (events.length !== 1) throw new Error("Refund receipt did not contain exactly one PaymentRefunded event");
const logIndex = Number(events[0].logIndex ?? 0);
const after = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getPayment", args: [requestKey] });
if (Number(after.status) !== 3) throw new Error("Refund post-state is not PAYMENT_REFUNDED");

const v4Hash = await genlayer.writeContract({
  account: genlayerAccount,
  address: V4,
  functionName: "confirm_arc_refund",
  args: [requestId, hash, logIndex],
  value: 0n,
});
const v4Receipt = await genlayer.waitForTransactionReceipt({ hash: v4Hash, status: TransactionStatus.FINALIZED, interval: 2500, retries: 120 });
const classification = classifyReceipt(v4Receipt);
if (!classification.successful) throw new Error(`V4 refund consumption failed: ${executionFailureDescription(v4Receipt)}`);
const postState = await genlayer.readContract({ address: V4, functionName: "get_request", args: [requestId] });
if (postState.payment_state !== "REFUNDED" || postState.state !== "REFUNDED") throw new Error(`V4 refund post-state mismatch: ${JSON.stringify(postState)}`);
console.log(JSON.stringify({
  network: "Arc Testnet",
  chainId,
  escrow: ESCROW,
  arc: { transaction: hash, explorer: `https://explorer.testnet.arc.io/tx/${hash}`, logIndex, caller: account.address, status: Number(after.status) },
  genlayer: { transaction: v4Hash, explorer: `https://explorer-studio.genlayer.com/tx/${v4Hash}`, status: classification.statusName, consensus: classification.rawResultName, execution: classification.txExecutionResultName },
  requestId,
  postState: { state: postState.state, paymentState: postState.payment_state },
}, null, 2));
