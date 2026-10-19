import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { assertInjectedWallet, CONTRACT_ADDRESS, getWriteClient, prepareStudionetWrite, STUDIONET_CHAIN_ID } from "./client";
import { executionFailureDescription, isFinalizedSuccessfulReceipt } from "./finality";

// Public release fallback: Vercel may build from the connected Git provider
// before its environment update is available. This is an address, never a
// secret; an explicit VITE value still takes precedence for future releases.
export const V4_CONTRACT_ADDRESS = (import.meta.env.VITE_V4_TRUSTPASS_CONTRACT_ADDRESS || "0x886582aB1a45452880685b6a50c748cAb7c954ce") as `0x${string}`;
export const V3_CONTRACT_ADDRESS = CONTRACT_ADDRESS;
export const V4_READ_CLIENT = createClient({ chain: studionet });

export type TrustPassPolicy = {
  found?: boolean;
  policy_id: string;
  version: number;
  creator: string;
  required_credentials: string[];
  minimum_proof_strength: "WEAK" | "MEDIUM" | "STRONG";
  maximum_evidence_age_seconds: number;
  maximum_trustpass_lifetime_seconds: number;
  external_humanity_required: boolean;
  minimum_humanity_score: number;
  permitted_assessment_use: string;
  assessment_price_usdc: number;
  enabled: boolean;
  policy_hash: `0x${string}`;
};

export type TrustPassRequest = {
  found?: boolean;
  request_id: string;
  requester: string;
  payer: string;
  subject: string;
  sponsored: boolean;
  purpose: string;
  policy_id: string;
  policy_version: number;
  policy_hash: `0x${string}`;
  state: string;
  created_at: number;
  payment_intent_expires_at: number;
  consent_expires_at: number;
  assessment_deadline: number;
  funded_at?: number;
  refund_available_at?: number;
  payment_nonce: number;
  consent_nonce: string;
  google_commitment: string;
  humanity_snapshot_ref: string;
  arc_tx_hash: string;
  arc_settlement_tx_hash: string;
  arc_refund_tx_hash: string;
  payment_state: string;
  assessment_id: string;
  proposed_outcome: "PASS" | "FAIL" | "INCONCLUSIVE" | "";
  reason_code: string;
  reasoning: string;
  expires_at: number;
};

export type TrustPassRecord = TrustPassRequest & {
  assessment_id: string;
  v3_contract_address: string;
  v4_contract_version: string;
  invalidated: boolean;
  outcome: "PASS" | "FAIL" | "INCONCLUSIVE";
  state: string;
  settled_at: number;
  assessed_at: number;
  expires_at: number;
  reason_code: string;
  arc_payment_tx_hash: string;
  arc_log_index?: number;
  arc_refund_log_index?: number;
  arc_deposit_block_number?: number;
  humanity_snapshot: string;
  google_commitment: string;
};

function v4Address(): `0x${string}` {
  if (!V4_CONTRACT_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(V4_CONTRACT_ADDRESS)) {
    throw new Error("VITE_V4_TRUSTPASS_CONTRACT_ADDRESS is not configured.");
  }
  return V4_CONTRACT_ADDRESS;
}

async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return await V4_READ_CLIENT.readContract({ address: v4Address(), functionName, args: args as any[] }) as unknown as T;
}

export function trustPassExplorerUrl(hash: string): string {
  return `https://explorer-studio.genlayer.com/tx/${hash}`;
}

export async function getV4Stats(): Promise<Record<string, unknown>> {
  return read<Record<string, unknown>>("get_stats");
}

export async function getPolicy(policyId: string): Promise<TrustPassPolicy> {
  return read<TrustPassPolicy>("get_policy", [policyId]);
}

export async function getOrganisationPolicies(wallet: string, offset = 0, limit = 50): Promise<TrustPassPolicy[]> {
  return read<TrustPassPolicy[]>("get_organisation_policies", [wallet, offset, limit]);
}

export async function getRequest(requestId: string): Promise<TrustPassRequest> {
  return read<TrustPassRequest>("get_request", [requestId]);
}

export async function getRequests(wallet: string, offset = 0, limit = 50): Promise<TrustPassRequest[]> {
  return read<TrustPassRequest[]>("get_requests", [wallet, offset, limit]);
}

export async function getPaymentIntent(requestId: string): Promise<Record<string, unknown>> {
  return read<Record<string, unknown>>("get_payment_intent", [requestId]);
}

export async function getPaymentStatus(requestId: string): Promise<Record<string, unknown>> {
  return read<Record<string, unknown>>("get_payment_status", [requestId]);
}

export async function getTrustPass(passId: string): Promise<TrustPassRecord> {
  return read<TrustPassRecord>("get_trustpass", [passId]);
}

export async function getTrustPasses(wallet: string, offset = 0, limit = 50): Promise<TrustPassRecord[]> {
  return read<TrustPassRecord[]>("get_trustpasses", [wallet, offset, limit]);
}

export async function checkTrustPass(passId: string, policyId: string, subject: string): Promise<Record<string, unknown>> {
  return read<Record<string, unknown>>("check_trustpass", [passId, policyId, subject]);
}

/** Stable consumer-facing enforcement read. The result is read from V4
 * state and current V3 eligibility; callers must branch on `reason` rather
 * than treating a browser-side assertion or payment receipt as a PASS. */
export async function consumerEligibility(subject: string, policyId = ""): Promise<Record<string, unknown>> {
  return read<Record<string, unknown>>("consumer_eligibility", [subject, policyId]);
}

export async function getHumanityEvidence(requestId: string): Promise<Record<string, unknown>> {
  return read<Record<string, unknown>>("get_humanity_evidence", [requestId]);
}

async function write(functionName: string, args: unknown[]): Promise<{ hash: `0x${string}`; receipt: unknown }> {
  const signer = await prepareStudionetWrite();
  await assertInjectedWallet(STUDIONET_CHAIN_ID, signer);
  const client = getWriteClient();
  const hash = await client.writeContract({ address: v4Address(), functionName, args: args as any[], value: 0n }) as unknown as `0x${string}`;
  const receipt = await client.waitForTransactionReceipt({ hash: hash as any, status: TransactionStatus.FINALIZED, interval: 2_500, retries: 120 });
  if (!isFinalizedSuccessfulReceipt(receipt)) {
    throw new Error(`V4 transaction ${hash} did not prove FINALIZED + MAJORITY_AGREE + FINISHED_WITH_RETURN: ${executionFailureDescription(receipt)}`);
  }
  return { hash, receipt };
}

export async function createPolicy(policyId: string, policy: Record<string, unknown>) {
  return write("create_policy", [policyId, JSON.stringify(policy)]);
}

export async function createAssessmentRequest(policyId: string, subject: string, purpose: string, sponsored = false) {
  return write("create_assessment_request", [policyId, subject, purpose, sponsored]);
}

export async function consentAssessment(requestId: string, purpose: string, nonce: string, expiresAt: number) {
  return write("consent_assessment", [requestId, purpose, nonce, expiresAt]);
}

export async function cancelAssessmentRequest(requestId: string, reason = "REQUEST_CANCELLED") {
  return write("cancel_assessment_request", [requestId, reason]);
}

export async function linkGoogleAttestation(requestId: string, evidenceUrl: string) {
  return write("link_google_attestation", [requestId, evidenceUrl]);
}

export async function revokeGoogleAttestation(requestId: string) {
  return write("revoke_google_attestation", [requestId]);
}

export async function refreshHumanityEvidence(requestId: string, blockNumber: number) {
  return write("refresh_humanity_evidence", [requestId, blockNumber]);
}

export async function confirmArcPayment(requestId: string, txHash: string, logIndex: number) {
  return write("confirm_arc_payment", [requestId, txHash, logIndex]);
}

export async function confirmArcRefund(requestId: string, txHash: string, logIndex: number) {
  return write("confirm_arc_refund", [requestId, txHash, logIndex]);
}

export async function evaluateAssessment(requestId: string) {
  return write("evaluate_assessment", [requestId]);
}

export function resultCommitment(request: TrustPassRequest): `0x${string}` {
  // The canonical commitment is computed by the contract; this helper is
  // intentionally only a display marker and is never used for eligibility.
  return `0x${request.assessment_id.padStart(64, "0").slice(-64)}`;
}
