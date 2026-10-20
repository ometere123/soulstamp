# v0.4.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""SoulStamp V4 TrustPass and Sybil Gate.

V4 is an assessment authority layered over the deployed V3 identity contract.
It never writes V3 state and never treats payment, a browser assertion, a
Google email, or an LLM sentence as proof.  Stable protocol facts are stored
as JSON strings so the contract keeps an append-only audit of the terms,
evidence commitments, payment references, and final decision.
"""

from genlayer import *
from datetime import datetime, timezone
import hashlib
import json
import re
from urllib.parse import urlparse


CONTRACT_VERSION = "soulstamp-v4.2-unified-passport-compatibility"
VERIFIER_VERSION = "soulstamp-v4.2-independent-assessment"
V3_CONTRACT_VERSION = "soulstamp-v3.0-continuity"
GENLAYER_CHAIN_ID = 61999
ARC_CHAIN_ID = 5042002
HUMAN_PASSPORT_CHAIN_ID = 11155420
HUMAN_PASSPORT_SCORE_SELECTOR = "0xd47875d0"
HUMAN_PASSPORT_THRESHOLD_RAW = 200000
HUMAN_PASSPORT_DECIMALS = 4
HUMAN_PASSPORT_EAS_ADDRESS = "0x4200000000000000000000000000000000000021"
HUMAN_PASSPORT_SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020"
HUMAN_PASSPORT_UNIFIED_SCHEMA_UID = "0x81d8758ccd97bbeea7642df29001f6046a676b3c24f808c4297db5ee36838dd8"
HUMAN_PASSPORT_UNIFIED_SCHEMA = "bool passing_score, uint8 score_decimals, uint128 scorer_id, uint32 score, uint32 threshold, tuple(string provider, uint256 score)[] stamps"
HUMAN_PASSPORT_UNIFIED_RESOLVER = "0xa2c832b63a20c06ccc2ca31c12b8248452729a4d"
HUMAN_PASSPORT_PERMITTED_ATTESTER = "0x8b1a76795e3cbadd79c5410d2c4d4827d9c1503a"
HUMAN_PASSPORT_APPROVED_SCORER_ID = 335
HUMAN_PASSPORT_GET_ATTESTATION_SELECTOR = "0xa3112a64"
HUMAN_PASSPORT_GET_SCHEMA_SELECTOR = "0xa2ea7c6e"
MAX_HUMAN_PASSPORT_STAMPS = 64
MAX_HUMAN_PASSPORT_PROVIDER_LENGTH = 128
MAX_HUMAN_PASSPORT_RESPONSE_BYTES = 131072
USDC_DECIMALS = 6
ASSESSMENT_PRICE_USDC = 1_000_000
PAYMENT_INTENT_TTL_SECONDS = 30 * 60
ASSESSMENT_DEADLINE_SECONDS = 72 * 60 * 60
TRUSTPASS_MAX_LIFETIME_SECONDS = 7 * 24 * 60 * 60
MAX_POLICY_EVIDENCE_AGE_SECONDS = 30 * 24 * 60 * 60
MAX_HUMANITY_SNAPSHOT_AGE_SECONDS = 7 * 24 * 60 * 60
MAX_JSON_LENGTH = 24000
MAX_POLICY_ID_LENGTH = 96
MAX_REASON_LENGTH = 1000

REQUEST_STATES = [
    "CREATED", "AWAITING_CONSENT", "CONSENTED", "AWAITING_PAYMENT", "FUNDED",
    "EVALUATING", "EVALUATED_PENDING_SETTLEMENT", "ACTIVE", "COMPLETED_FAIL",
    "COMPLETED_INCONCLUSIVE", "EXPIRED", "CANCELLED", "REFUNDED", "UNDELIVERABLE",
]
OUTCOMES = ["PASS", "FAIL", "INCONCLUSIVE"]
PAYMENT_STATES = ["NONE", "ESCROWED", "SETTLED", "REFUNDED"]

# These are generated from the Solidity event ABI and covered by the Arc
# receipt tests.  They are protocol constants, not values accepted from a
# browser or from a settlement operator.
PAYMENT_DEPOSITED_TOPIC = "0x4b8e0046bd7b248856bb764d99ba272dceb03c623ba895214e1f531dc8919e3d"
PAYMENT_SETTLED_TOPIC = "0xc5ccc90da3cc4831a228e4f176cd9981a752d016ec7ca1db2adc0c0ccda61186"
PAYMENT_REFUNDED_TOPIC = "0x42b8ba31338f985ac11f6eaa31356b5cbd8eaa2f7f01e453369f02f1cf234b98"

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_CONSENSUS = "[CONSENSUS]"


class SoulStampTrustPass(gl.Contract):
    """Policy-bound TrustPass authority for the immutable V3 identity layer."""

    policies: TreeMap[str, str]
    policy_ids: DynArray[str]
    requests: TreeMap[str, str]
    request_ids: DynArray[str]
    trustpasses: TreeMap[str, str]
    pass_ids: DynArray[str]
    google_commitments: TreeMap[str, str]
    used_google_attestation_ids: TreeMap[str, bool]
    used_google_nonces: TreeMap[str, bool]
    consumed_arc_payments: TreeMap[str, bool]
    used_consent_nonces: TreeMap[str, bool]
    humanity_snapshots: TreeMap[str, str]
    settlement_records: TreeMap[str, str]
    invalidated_passes: TreeMap[str, str]
    admin: str
    v3_contract_address: str
    arc_escrow_address: str
    settlement_operator: str
    google_attestation_base_url: str
    human_passport_decoder_address: str
    human_passport_rpc_url: str
    total_policies: u256
    total_requests: u256
    total_assessments: u256
    total_passes: u256
    total_settlements: u256
    total_refunds: u256
    request_nonce: u256
    pass_nonce: u256

    def __init__(
        self,
        v3_contract_address: str,
        arc_escrow_address: str,
        human_passport_decoder_address: str,
        human_passport_rpc_url: str,
        google_attestation_base_url: str = "",
        settlement_operator: str = "",
        admin_address: str = "",
    ) -> None:
        admin = admin_address or str(gl.message.sender_address)
        self._require_address(v3_contract_address, "V3 contract")
        self._require_address(arc_escrow_address, "Arc escrow")
        self._require_address(human_passport_decoder_address, "Human Passport decoder")
        self._require_https_origin(human_passport_rpc_url, "Human Passport RPC")
        if google_attestation_base_url:
            self._require_https_origin(google_attestation_base_url, "Google attestation issuer")
        if settlement_operator:
            self._require_address(settlement_operator, "Settlement operator")
        self._require_address(admin, "Admin")

        self.admin = self._addr(admin)
        self.v3_contract_address = self._addr(v3_contract_address)
        self.arc_escrow_address = self._addr(arc_escrow_address)
        self.human_passport_decoder_address = self._addr(human_passport_decoder_address)
        self.human_passport_rpc_url = str(human_passport_rpc_url).strip().rstrip("/")
        self.google_attestation_base_url = str(google_attestation_base_url).strip().rstrip("/")
        self.settlement_operator = self._addr(settlement_operator) if settlement_operator else self.admin
        self.total_policies = u256(0)
        self.total_requests = u256(0)
        self.total_assessments = u256(0)
        self.total_passes = u256(0)
        self.total_settlements = u256(0)
        self.total_refunds = u256(0)
        self.request_nonce = u256(0)
        self.pass_nonce = u256(0)

    # ------------------------------------------------------------------
    # Primitive validation and serialization
    # ------------------------------------------------------------------

    def _addr(self, value: str) -> str:
        return str(value or "").strip().lower()

    def _valid_address(self, value: str) -> bool:
        return bool(re.match(r"^0x[0-9a-fA-F]{40}$", str(value or "").strip()))

    def _require_address(self, value: str, label: str) -> None:
        if not self._valid_address(value):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {label} must be a valid 0x-prefixed address")

    def _require_https_origin(self, value: str, label: str) -> None:
        parsed = urlparse(str(value or "").strip().rstrip("/"))
        if parsed.scheme != "https" or not parsed.netloc or parsed.params or parsed.query or parsed.fragment:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {label} must be an HTTPS origin without query or fragment")

    def _require(self, condition: bool, message: str) -> None:
        if not condition:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {message}")

    def _now(self) -> u256:
        return u256(int(datetime.now(timezone.utc).timestamp()))

    def _dump(self, value) -> str:
        return json.dumps(value, sort_keys=True, separators=(",", ":"))

    def _load(self, raw: str, fallback=None):
        try:
            if not raw:
                return fallback
            return json.loads(str(raw))
        except Exception:
            return fallback

    def _clean_json(self, value: str, label: str) -> dict:
        raw = str(value or "").strip()
        self._require(bool(raw) and len(raw) <= MAX_JSON_LENGTH, f"{label} JSON is missing or too large")
        try:
            parsed = json.loads(raw)
        except Exception:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {label} JSON is malformed")
        self._require(isinstance(parsed, dict), f"{label} must be an object")
        return parsed

    def _sha(self, value: str) -> str:
        return "0x" + hashlib.sha256(str(value).encode("utf-8")).hexdigest()

    def _require_hex_hash(self, value: str, label: str) -> str:
        clean = str(value or "").strip().lower()
        self._require(bool(re.match(r"^0x[0-9a-f]{64}$", clean)), f"{label} must be a 32-byte hex value")
        return clean

    def _normalize_tx_hash(self, value: str) -> str:
        clean = str(value or "").strip().lower()
        self._require(bool(re.match(r"^0x[0-9a-f]{64}$", clean)), "Arc transaction hash is malformed")
        return clean

    def _hex_int(self, value: str, label: str = "RPC integer") -> int:
        clean = str(value or "").strip().lower()
        self._require(bool(re.match(r"^0x[0-9a-f]+$", clean)), f"Malformed {label}")
        try:
            return int(clean, 16)
        except Exception:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} Malformed {label}")

    def _topic_address(self, value: str) -> str:
        clean = str(value or "").strip().lower()
        self._require(bool(re.match(r"^0x[0-9a-f]{64}$", clean)), "Malformed Arc address topic")
        return "0x" + clean[-40:]

    def _sender(self) -> str:
        return self._addr(gl.message.sender_address)

    def _policy_hash(self, policy: dict) -> str:
        return str(policy.get("policy_hash", "")).lower()

    # ------------------------------------------------------------------
    # Policy engine
    # ------------------------------------------------------------------

    def _normalize_policy(self, policy_id: str, raw: dict, creator: str) -> dict:
        clean_id = str(policy_id or "").strip()
        self._require(bool(re.match(r"^[A-Za-z0-9._-]{1," + str(MAX_POLICY_ID_LENGTH) + r"}$", clean_id)), "Policy ID is malformed")
        required = raw.get("required_credentials", [])
        self._require(isinstance(required, list) and len(required) <= 4, "required_credentials must be a short list")
        normalized_required = []
        for item in required:
            value = str(item or "").strip().lower()
            self._require(value in ("github", "twitter", "discord", "google"), "Unsupported credential type")
            if value not in normalized_required:
                normalized_required.append(value)
        minimum_strength = str(raw.get("minimum_proof_strength", "MEDIUM") or "MEDIUM").upper()
        self._require(minimum_strength in ("WEAK", "MEDIUM", "STRONG"), "Invalid minimum proof strength")
        max_age = int(raw.get("maximum_evidence_age_seconds", MAX_POLICY_EVIDENCE_AGE_SECONDS) or 0)
        lifetime = int(raw.get("maximum_trustpass_lifetime_seconds", TRUSTPASS_MAX_LIFETIME_SECONDS) or 0)
        minimum_humanity = int(raw.get("minimum_humanity_score", HUMAN_PASSPORT_THRESHOLD_RAW) or 0)
        price = int(raw.get("assessment_price_usdc", ASSESSMENT_PRICE_USDC) or 0)
        self._require(max_age > 0 and max_age <= MAX_POLICY_EVIDENCE_AGE_SECONDS, "Evidence age exceeds protocol bounds")
        self._require(lifetime > 0 and lifetime <= TRUSTPASS_MAX_LIFETIME_SECONDS, "TrustPass lifetime exceeds protocol bounds")
        self._require(minimum_humanity >= 0 and minimum_humanity <= 1_000_000, "Humanity threshold is outside bounds")
        self._require(price == ASSESSMENT_PRICE_USDC, "The initial V4 price is exactly 1 USDC")
        canonical = {
            "policy_id": clean_id,
            "version": int(raw.get("version", 1) or 1),
            "creator": self._addr(creator),
            "required_credentials": normalized_required,
            "minimum_proof_strength": minimum_strength,
            "maximum_evidence_age_seconds": max_age,
            "maximum_trustpass_lifetime_seconds": lifetime,
            "external_humanity_required": bool(raw.get("external_humanity_required", False)),
            "minimum_humanity_score": minimum_humanity,
            "permitted_assessment_use": str(raw.get("permitted_assessment_use", "access_decision") or "access_decision").strip()[:200],
            "assessment_price_usdc": price,
            "enabled": bool(raw.get("enabled", True)),
        }
        self._require(canonical["version"] > 0 and canonical["version"] <= 1000, "Policy version is invalid")
        canonical["policy_hash"] = self._sha(self._dump(canonical))
        return canonical

    @gl.public.write
    def create_policy(self, policy_id: str, policy_json: str) -> str:
        creator = self._sender()
        raw = self._clean_json(policy_json, "Policy")
        existing = self.policies.get(str(policy_id).strip())
        self._require(existing is None, "Policy ID already exists; publish a new versioned policy ID")
        policy = self._normalize_policy(policy_id, raw, creator)
        policy["created_at"] = int(self._now())
        policy["updated_at"] = int(policy["created_at"])
        self.policies[str(policy_id).strip()] = self._dump(policy)
        self.policy_ids.append(str(policy_id).strip())
        self.total_policies = u256(int(self.total_policies) + 1)
        return self._dump(policy)

    @gl.public.write
    def set_policy_enabled(self, policy_id: str, enabled: bool) -> None:
        """Pause or resume new use without rewriting the policy hash."""
        clean_id = str(policy_id).strip()
        policy = self._load(self.policies.get(clean_id, ""), None)
        self._require(isinstance(policy, dict), "Policy not found")
        self._require(self._sender() in (str(policy.get("creator", "")).lower(), self.admin), "Only the policy creator or admin can change policy availability")
        policy["enabled"] = bool(enabled)
        policy["updated_at"] = int(self._now())
        self.policies[clean_id] = self._dump(policy)

    @gl.public.view
    def get_policy(self, policy_id: str) -> dict:
        raw = self.policies.get(str(policy_id).strip(), "")
        policy = self._load(raw, None)
        if not isinstance(policy, dict):
            return {"found": False}
        policy["found"] = True
        return policy

    @gl.public.view
    def get_organisation_policies(self, organisation: str, offset: u32 = u32(0), limit: u32 = u32(50)) -> list:
        wallet = self._addr(organisation)
        result = []
        start = int(offset)
        maximum = min(int(limit), 100)
        for index in range(start, len(self.policy_ids)):
            policy = self._load(self.policies.get(self.policy_ids[index], ""), {})
            if str(policy.get("creator", "")).lower() == wallet:
                result.append(policy)
                if len(result) >= maximum:
                    break
        return result

    # ------------------------------------------------------------------
    # V3 and evidence facts
    # ------------------------------------------------------------------

    def _read_v3(self, subject: str) -> dict:
        try:
            v3 = gl.get_contract_at(Address(self.v3_contract_address))
            eligibility = v3.view().consumer_eligibility(subject)
            identity = v3.view().get_identity(subject)
            if not isinstance(eligibility, dict):
                return {"available": False, "reason": "V3_MALFORMED_ELIGIBILITY"}
            if not isinstance(identity, dict):
                return {"available": False, "reason": "V3_MALFORMED_IDENTITY"}
            accounts = identity.get("linked_accounts", [])
            normalized_accounts = []
            if isinstance(accounts, list):
                for account in accounts:
                    if not isinstance(account, dict):
                        continue
                    dossier = account.get("dossier", {})
                    if not isinstance(dossier, dict):
                        dossier = {}
                    normalized_accounts.append({
                        "platform": str(account.get("platform", "")).lower(),
                        "username": str(account.get("username", "")),
                        "canonical_platform_id": str(account.get("canonical_platform_id", "") or ""),
                        "proof_status": str(account.get("proof_status", "")),
                        "proof_strength": str(account.get("proof_strength", "")),
                        "confidence_score": int(account.get("confidence_score", 0) or 0),
                        "is_active": bool(account.get("is_active", False)),
                        # V3's verified_at is an append-only event marker, not
                        # wall-clock time.  Keep it for audit/debugging only;
                        # freshness below is derived from the V3 dossier.
                        "verified_at_marker": int(account.get("verified_at", 0) or 0),
                        "evidence_issued_at": int(dossier.get("evidence_issued_at", 0) or 0),
                        "evidence_expires_at": int(dossier.get("evidence_expires_at", 0) or 0),
                    })
            return {
                "available": True,
                "eligible": bool(eligibility.get("eligible", False)),
                "eligibility_reason": str(eligibility.get("reason", "")),
                "identity_state": str(identity.get("identity_state", "")),
                "is_flagged": bool(identity.get("is_flagged", False)),
                "principal_id": str(identity.get("principal_id", "")),
                "accounts": normalized_accounts,
            }
        except Exception:
            return {"available": False, "reason": "V3_READ_UNAVAILABLE"}

    def _credential_facts(self, v3: dict, policy: dict, now: int) -> dict:
        required = policy.get("required_credentials", [])
        accounts = v3.get("accounts", []) if isinstance(v3, dict) else []
        results = {}
        for credential in required:
            credential = "twitter" if str(credential).lower() == "x" else str(credential).lower()
            matches = [account for account in accounts if account.get("platform") == credential]
            active = [
                account for account in matches
                if account.get("proof_status") == "ACTIVE"
                and bool(account.get("is_active", True))
                and account.get("confidence_score", 0) > 0
            ]
            max_age = int(policy.get("maximum_evidence_age_seconds", MAX_POLICY_EVIDENCE_AGE_SECONDS) or 0)
            fresh = []
            for account in active:
                # These are the authentic V3 proof-health fields.  V3's
                # `verified_at` is a monotonic audit marker and must never be
                # subtracted from Unix time.
                dossier = account.get("dossier", {})
                if not isinstance(dossier, dict):
                    dossier = {}
                expires_at = int(account.get("evidence_expires_at", dossier.get("evidence_expires_at", 0)) or 0)
                issued_at = int(account.get("evidence_issued_at", dossier.get("evidence_issued_at", 0)) or 0)
                if expires_at <= 0 or expires_at < now:
                    continue
                # GitHub/X V3 evidence intentionally has no provider-issued
                # Unix timestamp (evidence_issued_at == 0).  In that case V3's
                # ACTIVE + dossier expiry is the complete freshness source.
                # Only apply an age bound when V3 actually supplied an issued
                # timestamp; never substitute the event marker.
                if issued_at > 0 and (issued_at > now or now - issued_at > max_age):
                    continue
                fresh.append(account)
            strength_order = {"WEAK": 1, "MEDIUM": 2, "STRONG": 3}
            acceptable = [account for account in fresh if strength_order.get(str(account.get("proof_strength", "WEAK")), 0) >= strength_order.get(str(policy.get("minimum_proof_strength", "MEDIUM")), 2)]
            results[credential] = {
                "present": bool(matches),
                "active": bool(active),
                "fresh": bool(fresh),
                "acceptable": bool(acceptable),
                "freshness_source": "V3_DOSSIER_EXPIRY",
                "canonical_ids": sorted([str(account.get("canonical_platform_id", "")) for account in acceptable if account.get("canonical_platform_id")]),
            }
        return results

    def _google_facts(self, request: dict, now: int) -> dict:
        commitment = str(request.get("google_commitment", "") or "")
        if not commitment:
            return {"present": False, "valid": False, "reason": "GOOGLE_EVIDENCE_MISSING"}
        record = self._load(self.google_commitments.get(commitment, ""), {})
        valid = bool(record.get("active")) and str(record.get("wallet", "")).lower() == str(request.get("subject", "")).lower()
        expires = int(record.get("expires_at", 0) or 0)
        if expires <= now:
            valid = False
        return {
            "present": True,
            "valid": valid,
            "commitment": commitment,
            "commitment_version": str(request.get("google_commitment_version", "")),
            "attestation_id": str(record.get("attestation_id", "")),
            "expires_at": expires,
            "reason": "GOOGLE_EVIDENCE_VALID" if valid else "GOOGLE_EVIDENCE_EXPIRED_OR_REVOKED",
        }

    def _humanity_facts(self, request: dict, policy: dict, now: int) -> dict:
        if not bool(policy.get("external_humanity_required")):
            return {"required": False, "valid": True, "reason": "HUMANITY_NOT_REQUIRED"}
        snapshot = self._load(self.humanity_snapshots.get(str(request.get("request_id", "")), ""), {})
        if not snapshot:
            return {"required": True, "valid": False, "reason": "HUMANITY_EVIDENCE_MISSING"}
        raw_score = int(snapshot.get("raw_score", -1) or -1)
        observed_at = int(snapshot.get("observed_at", 0) or 0)
        block_timestamp = int(snapshot.get("block_timestamp", 0) or 0)
        common_valid = (
            str(snapshot.get("wallet", "")).lower() == str(request.get("subject", "")).lower()
            and int(snapshot.get("chain_id", 0) or 0) == HUMAN_PASSPORT_CHAIN_ID
            and raw_score >= int(policy.get("minimum_humanity_score", HUMAN_PASSPORT_THRESHOLD_RAW))
            and observed_at > 0 and now - observed_at <= MAX_HUMANITY_SNAPSHOT_AGE_SECONDS
            and block_timestamp > 0 and block_timestamp <= now
            and now - block_timestamp <= MAX_HUMANITY_SNAPSHOT_AGE_SECONDS
        )
        if str(snapshot.get("evidence_type", "")) == "eas_unified_v1":
            expiration_time = int(snapshot.get("expiration_time", 0) or 0)
            created_at = int(snapshot.get("created_at", 0) or 0)
            score_threshold = int(snapshot.get("threshold_raw", 0) or 0)
            valid = (
                common_valid
                and str(snapshot.get("eas_address", "")).lower() == HUMAN_PASSPORT_EAS_ADDRESS
                and str(snapshot.get("schema_uid", "")).lower() == HUMAN_PASSPORT_UNIFIED_SCHEMA_UID
                and str(snapshot.get("schema_registry", "")).lower() == HUMAN_PASSPORT_SCHEMA_REGISTRY_ADDRESS
                and str(snapshot.get("resolver", "")).lower() == HUMAN_PASSPORT_UNIFIED_RESOLVER
                and str(snapshot.get("attester", "")).lower() == HUMAN_PASSPORT_PERMITTED_ATTESTER
                and int(snapshot.get("scorer_id", -1) or -1) == HUMAN_PASSPORT_APPROVED_SCORER_ID
                and int(snapshot.get("score_decimals", -1) or -1) == HUMAN_PASSPORT_DECIMALS
                and bool(snapshot.get("passing_score", False))
                and score_threshold == HUMAN_PASSPORT_THRESHOLD_RAW
                and raw_score >= score_threshold
                and created_at > 0 and created_at <= block_timestamp
                and expiration_time > now
                and int(snapshot.get("revocation_time", 0) or 0) == 0
                and bool(snapshot.get("evidence_commitment", ""))
            )
            reason = "HUMANITY_UNIFIED_ATTESTATION_VALID" if valid else "HUMANITY_UNIFIED_ATTESTATION_INVALID_OR_STALE"
        else:
            valid = (
                common_valid
                and str(snapshot.get("decoder", "")).lower() == self.human_passport_decoder_address
            )
            reason = "HUMANITY_SCORE_MEETS_THRESHOLD" if valid else "HUMANITY_SCORE_BELOW_THRESHOLD_OR_STALE"
        return {
            "required": True,
            "valid": valid,
            "raw_score": raw_score,
            "score_scaled": self._score_decimal(raw_score),
            "chain_id": int(snapshot.get("chain_id", 0) or 0),
            "decoder": str(snapshot.get("decoder", "")),
            "block_number": int(snapshot.get("block_number", 0) or 0),
            "block_hash": str(snapshot.get("block_hash", "")),
            "block_timestamp": block_timestamp,
            "observed_at": observed_at,
            "evidence_type": str(snapshot.get("evidence_type", "legacy_decoder_v1") or "legacy_decoder_v1"),
            "attestation_uid": str(snapshot.get("attestation_uid", "")),
            "schema_uid": str(snapshot.get("schema_uid", "")),
            "scorer_id": int(snapshot.get("scorer_id", 0) or 0),
            "expiration_time": int(snapshot.get("expiration_time", 0) or 0),
            "revocation_time": int(snapshot.get("revocation_time", 0) or 0),
            "reason": reason,
        }

    def _score_decimal(self, raw_score: int) -> str:
        if int(raw_score) < 0:
            return "-1"
        whole = int(raw_score) // 10000
        fraction = str(int(raw_score) % 10000).rjust(4, "0").rstrip("0")
        return str(whole) + ("." + fraction if fraction else "")

    def _assessment_facts(self, request: dict, policy: dict, now: int, v3_snapshot: dict) -> dict:
        v3 = v3_snapshot
        credentials = self._credential_facts(v3, policy, now) if v3.get("available") else {}
        google = self._google_facts(request, now)
        humanity = self._humanity_facts(request, policy, now)
        unavailable = []
        if not v3.get("available"):
            unavailable.append("V3_READ_UNAVAILABLE")
        for credential in policy.get("required_credentials", []):
            normalized_credential = "twitter" if str(credential).lower() == "x" else str(credential).lower()
            if normalized_credential != "google" and not credentials.get(normalized_credential, {}).get("acceptable"):
                unavailable.append("MISSING_OR_STALE_" + normalized_credential.upper())
        if "google" in policy.get("required_credentials", []) and not google.get("valid"):
            unavailable.append(str(google.get("reason", "GOOGLE_EVIDENCE_INVALID")))
        if humanity.get("required") and not humanity.get("valid"):
            unavailable.append(str(humanity.get("reason", "HUMANITY_EVIDENCE_INVALID")))

        if not v3.get("available"):
            outcome = "INCONCLUSIVE"
            reason = "V3_READ_UNAVAILABLE"
        elif v3.get("identity_state") in ("CONTESTED", "RECOVERY_PENDING") or v3.get("is_flagged"):
            outcome = "FAIL"
            reason = "V3_IDENTITY_NOT_ELIGIBLE"
        elif unavailable:
            # A real missing, stale, revoked, duplicate, or insufficient
            # policy fact is a completed negative assessment. Only an
            # unavailable infrastructure dependency becomes inconclusive.
            infrastructure = any(item in ("V3_READ_UNAVAILABLE",) for item in unavailable)
            outcome = "INCONCLUSIVE" if infrastructure else "FAIL"
            reason = str(unavailable[0])
        else:
            outcome = "PASS"
            reason = "ALL_POLICY_FACTS_SATISFIED"
        return {
            "v3": v3,
            "credentials": credentials,
            "google": google,
            "humanity": humanity,
            "outcome": outcome,
            "reason_code": reason,
            "decision_timestamp": now,
        }

    # ------------------------------------------------------------------
    # Arc receipt consensus
    # ------------------------------------------------------------------

    def _rpc_call_nondet(self, method: str, params: list):
        try:
            response = gl.nondet.web.request(
                self._arc_rpc_url(),
                method="POST",
                headers={"content-type": "application/json"},
                body=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}),
            )
            status = int(getattr(response, "status_code", getattr(response, "status", 0)))
            if status != 200:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Arc RPC HTTP {status}")
            body = response.body.decode("utf-8") if isinstance(response.body, (bytes, bytearray)) else str(response.body)
            payload = json.loads(body)
            if payload.get("error") is not None:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} Arc RPC returned an error")
            return payload.get("result")
        except Exception as error:
            if isinstance(error, gl.vm.UserError):
                raise
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} Arc RPC unavailable: {error}")

    def _arc_rpc_url(self) -> str:
        # The V4 contract only accepts the canonical Arc Testnet endpoint.
        return "https://rpc.testnet.arc.io"

    def _stable_receipt(self, tx_hash: str) -> dict:
        receipt = self._rpc_call_nondet("eth_getTransactionReceipt", [tx_hash])
        if receipt is None:
            return {"receipt": None}
        logs = []
        raw_logs = receipt.get("logs", []) if isinstance(receipt, dict) else []
        if isinstance(raw_logs, list):
            for log in raw_logs:
                if not isinstance(log, dict):
                    continue
                topics = log.get("topics", [])
                logs.append({
                    "address": str(log.get("address", "")).lower(),
                    "logIndex": str(log.get("logIndex", "")).lower(),
                    "topics": [str(topic).lower() for topic in topics] if isinstance(topics, list) else [],
                    "data": str(log.get("data", "")).lower(),
                })
        return {"receipt": {
            "transactionHash": str(receipt.get("transactionHash", "")).lower(),
            "status": str(receipt.get("status", "")).lower(),
            "to": str(receipt.get("to", "")).lower(),
            "blockNumber": str(receipt.get("blockNumber", "")).lower(),
            "logs": logs,
        }}

    def _receipt_consensus(self, tx_hash: str) -> dict:
        def fetch():
            return self._dump(self._stable_receipt(tx_hash))
        raw = gl.eq_principle.strict_eq(fetch)
        parsed = self._load(str(raw), None)
        if not isinstance(parsed, dict):
            raise gl.vm.UserError(f"{ERROR_CONSENSUS} Arc receipt consensus failed")
        return parsed

    def _verify_event(self, tx_hash: str, log_index: int, topic: str, request: dict, event_kind: str) -> dict:
        consensus = self._receipt_consensus(tx_hash)
        receipt = consensus.get("receipt")
        self._require(receipt is not None, "Arc receipt was not found")
        self._require(receipt.get("transactionHash") == tx_hash, "Arc receipt transaction hash mismatch")
        self._require(self._hex_int(receipt.get("status", "0x0"), "Arc receipt status") == 1, "Arc transaction failed")
        self._require(str(receipt.get("to", "")).lower() == self.arc_escrow_address, "Arc receipt target is not the configured escrow")
        self._require(self._hex_int(receipt.get("blockNumber", "0x0"), "Arc block number") > 0, "Arc receipt is not committed")
        selected = None
        for log in receipt.get("logs", []):
            if self._hex_int(log.get("logIndex", "0x0"), "Arc log index") == int(log_index):
                selected = log
                break
        self._require(selected is not None, "Expected Arc escrow event log was not found")
        self._require(str(selected.get("address", "")).lower() == self.arc_escrow_address, "Arc event emitter mismatch")
        topics = selected.get("topics", [])
        self._require(isinstance(topics, list) and len(topics) == 4, "Malformed Arc escrow event")
        self._require(str(topics[0]).lower() == topic, "Unexpected Arc escrow event signature")
        self._require(str(topics[1]).lower() == self._bytes32_request(request["request_id"]), "Arc request ID mismatch")
        body = str(selected.get("data", ""))
        self._require(body.startswith("0x"), "Malformed Arc event data")
        words = body[2:]
        self._require(len(words) >= 64, "Arc event data is incomplete")
        if event_kind == "deposit":
            self._require(len(words) == 256, "Malformed Arc deposit event data")
            policy_hash = "0x" + words[0:64]
            amount = int(words[64:128], 16)
            intent_expiry = int(words[128:192], 16)
            nonce = int(words[192:256], 16)
            self._require(policy_hash == str(request.get("policy_hash", "")).lower(), "Arc policy binding mismatch")
            self._require(amount == ASSESSMENT_PRICE_USDC, "Arc payment amount mismatch")
            self._require(nonce == int(request.get("payment_nonce", 0)), "Arc payment nonce mismatch")
            self._require(intent_expiry == int(request.get("payment_intent_expires_at", 0)), "Arc intent expiry mismatch")
            self._require(self._topic_address(topics[2]) == str(request.get("payer", "")).lower(), "Arc payer mismatch")
            self._require(self._topic_address(topics[3]) == str(request.get("subject", "")).lower(), "Arc subject mismatch")
            return {"tx_hash": tx_hash, "log_index": int(log_index), "block_number": self._hex_int(receipt["blockNumber"]), "amount": amount, "policy_hash": policy_hash}
        if event_kind == "settlement":
            self._require(len(words) == 192, "Malformed Arc settlement event data")
            policy_hash = "0x" + words[0:64]
            outcome = int(words[64:128], 16)
            result_commitment = "0x" + words[128:192]
            self._require(policy_hash == str(request.get("policy_hash", "")).lower(), "Arc settlement policy mismatch")
            self._require(str(topics[2]).lower() == self._bytes32_request(str(request.get("assessment_id", ""))), "Arc assessment ID mismatch")
            self._require(self._topic_address(topics[3]) == str(request.get("subject", "")).lower(), "Arc settlement subject mismatch")
            self._require(outcome == {"PASS": 1, "FAIL": 2, "INCONCLUSIVE": 3}.get(str(request.get("proposed_outcome", "")), 0), "Arc settlement outcome mismatch")
            return {"tx_hash": tx_hash, "log_index": int(log_index), "block_number": self._hex_int(receipt["blockNumber"]), "result_commitment": result_commitment}
        if event_kind == "refund":
            self._require(len(words) == 64, "Malformed Arc refund event data")
            amount = int(words[0:64], 16)
            self._require(amount == ASSESSMENT_PRICE_USDC, "Arc refund amount mismatch")
            self._require(self._topic_address(topics[2]) == str(request.get("payer", "")).lower(), "Arc refund payer mismatch")
            return {"tx_hash": tx_hash, "log_index": int(log_index), "block_number": self._hex_int(receipt["blockNumber"]), "amount": amount}
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown Arc event kind")

    def _bytes32_request(self, request_id: str) -> str:
        return self._sha("SOULSTAMP-V4-REQUEST-ID:" + str(request_id))

    # ------------------------------------------------------------------
    # Request and consent lifecycle
    # ------------------------------------------------------------------

    def _request(self, request_id: str) -> dict:
        request = self._load(self.requests.get(request_id, ""), None)
        self._require(isinstance(request, dict), "Assessment request not found")
        return request

    def _policy(self, policy_id: str) -> dict:
        return self._policy_record(policy_id, require_enabled=True)

    def _policy_record(self, policy_id: str, require_enabled: bool = False) -> dict:
        policy = self._load(self.policies.get(policy_id, ""), None)
        self._require(isinstance(policy, dict), "Policy not found")
        if require_enabled:
            self._require(bool(policy.get("enabled")), "Policy is disabled")
        return policy

    @gl.public.write
    def create_assessment_request(self, policy_id: str, subject_wallet: str, purpose: str, sponsored: bool = False) -> str:
        subject = self._addr(subject_wallet)
        self._require_address(subject, "Subject wallet")
        policy = self._policy(str(policy_id).strip())
        caller = self._sender()
        if not sponsored:
            self._require(caller == subject, "Self-paid requests must be created by the subject wallet")
        self.request_nonce = u256(int(self.request_nonce) + 1)
        nonce = int(self.request_nonce)
        now = int(self._now())
        request_id = hashlib.sha256(f"SOULSTAMP-V4-REQUEST:{self._addr(self_address())}:{caller}:{subject}:{policy['policy_hash']}:{nonce}".encode()).hexdigest().upper()
        request = {
            "request_id": request_id,
            "requester": caller,
            "payer": caller,
            "subject": subject,
            "sponsored": bool(sponsored),
            "purpose": str(purpose or "access_decision").strip()[:200],
            "policy_id": str(policy_id).strip(),
            "policy_version": int(policy.get("version", 1)),
            "policy_hash": policy["policy_hash"],
            "state": "AWAITING_CONSENT",
            "created_at": now,
            "consent_deadline": now + PAYMENT_INTENT_TTL_SECONDS,
            "payment_intent_expires_at": now + PAYMENT_INTENT_TTL_SECONDS,
            "assessment_deadline": now + ASSESSMENT_DEADLINE_SECONDS,
            "payment_nonce": nonce,
            "consent_nonce": "",
            "consent_expires_at": 0,
            "google_commitment": "",
            "google_commitment_version": "",
            "humanity_snapshot_ref": "",
            "arc_tx_hash": "",
            "arc_log_index": -1,
            "arc_settlement_tx_hash": "",
            "arc_settlement_log_index": -1,
            "arc_refund_tx_hash": "",
            "arc_refund_log_index": -1,
            "payment_state": "NONE",
            "assessment_id": "",
            "proposed_outcome": "",
            "reason_code": "",
            "reasoning": "",
            "evaluated_at": 0,
            "settled_at": 0,
            "expires_at": 0,
        }
        self.requests[request_id] = self._dump(request)
        self.request_ids.append(request_id)
        self.total_requests = u256(int(self.total_requests) + 1)
        return self._dump(request)

    @gl.public.write
    def consent_assessment(self, request_id: str, purpose: str, consent_nonce: str, expires_at: u256) -> None:
        request = self._request(str(request_id))
        self._require(request["state"] == "AWAITING_CONSENT", "Request is not awaiting consent")
        self._require(self._sender() == request["subject"], "Only the subject wallet can consent")
        now = int(self._now())
        exp = int(expires_at)
        nonce = str(consent_nonce or "").strip()
        self._require(str(purpose or "").strip() == request["purpose"], "Consent purpose does not match the request")
        self._require(bool(re.match(r"^[A-Za-z0-9_-]{16,128}$", nonce)), "Consent nonce is malformed")
        self._require(exp > now and exp <= int(request["consent_deadline"]), "Consent expiry is outside the request window")
        self._require(self.used_consent_nonces.get(nonce) is None, "Consent nonce has already been used")
        self.used_consent_nonces[nonce] = True
        request["state"] = "AWAITING_PAYMENT"
        request["consent_nonce"] = nonce
        request["consent_expires_at"] = exp
        # Bind the Arc intent window to the exact consent window.  The Arc
        # escrow rejects a deposit whose intent expiry has passed, so a later
        # GenLayer confirmation can safely accept a deposit that was actually
        # made on time without treating stale consent as authorization.
        request["payment_intent_expires_at"] = exp
        request["consented_at"] = now
        self.requests[str(request_id)] = self._dump(request)

    @gl.public.write
    def cancel_assessment_request(self, request_id: str, reason: str = "REQUEST_CANCELLED") -> None:
        """Cancel an unpaid request without touching any V3 identity state."""
        request = self._request(str(request_id))
        self._require(request["state"] in ("AWAITING_CONSENT", "AWAITING_PAYMENT"), "Request cannot be cancelled after funding")
        self._require(request["payment_state"] == "NONE", "A funded request must use the expiry/refund path")
        self._require(self._sender() in (request["requester"], request["subject"]), "Only the requester or subject can cancel")
        request["state"] = "CANCELLED"
        request["cancelled_at"] = int(self._now())
        request["cancellation_reason"] = str(reason or "REQUEST_CANCELLED")[:MAX_REASON_LENGTH]
        self.requests[str(request_id)] = self._dump(request)

    @gl.public.view
    def get_payment_intent(self, request_id: str) -> dict:
        request = self._request(str(request_id))
        return {
            "request_id": request["request_id"],
            "request_key": self._bytes32_request(request["request_id"]),
            "escrow": self.arc_escrow_address,
            "arc_chain_id": ARC_CHAIN_ID,
            "payer": request["payer"],
            "subject": request["subject"],
            "policy_hash": request["policy_hash"],
            "amount_usdc_base_units": ASSESSMENT_PRICE_USDC,
            "payment_nonce": int(request["payment_nonce"]),
            "intent_expires_at": int(request["payment_intent_expires_at"]),
            "consent_expires_at": int(request.get("consent_expires_at", 0) or 0),
            "state": request["state"],
        }

    # ------------------------------------------------------------------
    # Google and Human Passport evidence
    # ------------------------------------------------------------------

    def _google_url(self, evidence_url: str) -> None:
        self._require(bool(self.google_attestation_base_url), "Google attestation issuer is not configured")
        configured = urlparse(self.google_attestation_base_url)
        parsed = urlparse(str(evidence_url or "").strip())
        prefix = configured.path.rstrip("/") + "/api/google/attestations/"
        self._require(
            parsed.scheme == "https" and parsed.netloc.lower() == configured.netloc.lower()
            and not parsed.params and not parsed.query and not parsed.fragment
            and parsed.path.startswith(prefix),
            "Google evidence URL is outside the configured Worker endpoint",
        )
        token = parsed.path[len(prefix):]
        self._require(
            bool(re.match(r"^[A-Za-z0-9_-]{24,3800}\.[A-Za-z0-9_-]{43}$", token)),
            "Google evidence token is malformed",
        )

    def _fetch_json(self, url: str) -> dict:
        try:
            response = gl.nondet.web.get(url)
            status = int(getattr(response, "status_code", getattr(response, "status", 0)))
            if status >= 500:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Evidence source returned HTTP {status}")
            if status >= 400:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} Evidence source returned HTTP {status}")
            body = response.body.decode("utf-8") if isinstance(response.body, (bytes, bytearray)) else str(response.body)
            self._require(len(body) <= MAX_JSON_LENGTH, "Evidence response is too large")
            parsed = json.loads(body)
            self._require(isinstance(parsed, dict), "Evidence response is not an object")
            return parsed
        except Exception as error:
            if isinstance(error, gl.vm.UserError):
                raise
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} Evidence source unavailable: {error}")

    @gl.public.write
    def link_google_attestation(self, request_id: str, evidence_url: str) -> None:
        request = self._request(str(request_id))
        self._require(self._sender() == request["subject"], "Only the subject can link Google evidence")
        self._require(request["state"] in ("AWAITING_PAYMENT", "FUNDED", "EVALUATING"), "Request is not accepting Google evidence")
        self._google_url(evidence_url)
        evidence_url = str(evidence_url).strip()

        def leader_fn():
            parsed = self._fetch_json(evidence_url)
            return {
                "platform": str(parsed.get("platform", "")),
                "issuer": str(parsed.get("issuer", "") or "").strip().rstrip("/"),
                "wallet": self._addr(parsed.get("wallet", "")),
                "chain_id": int(parsed.get("chain_id", 0) or 0),
                "v4_contract": self._addr(parsed.get("v4_contract", "")),
                "pending_id": str(parsed.get("pending_id", "")),
                "purpose": str(parsed.get("purpose", "")),
                "nonce": str(parsed.get("nonce", "") or "").strip(),
                "attestation_id": str(parsed.get("attestation_id", "") or "").strip(),
                "issued_at": int(parsed.get("issued_at", 0) or 0),
                "expires_at": int(parsed.get("expires_at", 0) or 0),
                "account_commitment": str(parsed.get("account_commitment", "") or "").strip().lower(),
            }

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return) or not isinstance(leader_result.calldata, dict):
                return False
            try:
                mine = leader_fn()
            except Exception:
                return False
            return mine == leader_result.calldata

        try:
            parsed = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        except Exception as error:
            if isinstance(error, gl.vm.UserError):
                raise
            raise gl.vm.UserError(f"{ERROR_CONSENSUS} Google attestation validators did not agree: {error}")
        self._require(isinstance(parsed, dict), "Google attestation response is malformed")
        now = int(self._now())
        commitment = str(parsed.get("account_commitment", "") or "").strip().lower()
        issuer = str(parsed.get("issuer", "") or "").strip().rstrip("/")
        self._require(bool(re.match(r"^v[0-9]+:[a-z0-9_-]{16,128}$", commitment)), "Google commitment is malformed")
        self._require(issuer == self.google_attestation_base_url, "Google attestation issuer mismatch")
        self._require(str(parsed.get("platform", "")) == "google", "Google attestation platform mismatch")
        self._require(self._addr(parsed.get("wallet", "")) == request["subject"], "Google wallet binding mismatch")
        self._require(int(parsed.get("chain_id", 0) or 0) == GENLAYER_CHAIN_ID, "Google chain binding mismatch")
        self._require(self._addr(parsed.get("v4_contract", "")) == self._addr(self_address()), "Google contract binding mismatch")
        self._require(str(parsed.get("pending_id", "")) == request["request_id"], "Google request binding mismatch")
        self._require(str(parsed.get("purpose", "")) == "google_link", "Google attestation purpose mismatch")
        nonce = str(parsed.get("nonce", "") or "").strip()
        attestation_id = str(parsed.get("attestation_id", "") or "").strip()
        issued_at = int(parsed.get("issued_at", 0) or 0)
        expires_at = int(parsed.get("expires_at", 0) or 0)
        self._require(bool(nonce) and bool(attestation_id), "Google attestation replay fields are missing")
        self._require(issued_at <= now and expires_at > now and expires_at <= now + PAYMENT_INTENT_TTL_SECONDS, "Google attestation is stale or too long-lived")
        self._require(self.used_google_attestation_ids.get(attestation_id) is None, "Google attestation has already been used")
        self._require(self.used_google_nonces.get(nonce) is None, "Google attestation nonce has already been used")
        existing = self._load(self.google_commitments.get(commitment, ""), {})
        if existing.get("active") and str(existing.get("wallet", "")).lower() != request["subject"]:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Google account commitment is already linked to another active wallet")
        self.used_google_attestation_ids[attestation_id] = True
        self.used_google_nonces[nonce] = True
        record = {
            "wallet": request["subject"], "request_id": request["request_id"], "active": True,
            "issuer": issuer, "nonce": nonce, "attestation_id": attestation_id,
            "commitment_version": commitment.split(":", 1)[0], "issued_at": issued_at,
            "expires_at": expires_at, "evidence_url_hash": self._sha(str(evidence_url).strip()),
        }
        self.google_commitments[commitment] = self._dump(record)
        request["google_commitment"] = commitment
        request["google_commitment_version"] = record["commitment_version"]
        self.requests[str(request_id)] = self._dump(request)

    @gl.public.write
    def revoke_google_attestation(self, request_id: str) -> None:
        request = self._request(str(request_id))
        self._require(self._sender() == request["subject"], "Only the subject can revoke Google evidence")
        commitment = str(request.get("google_commitment", "") or "")
        self._require(bool(commitment), "Request has no Google evidence")
        record = self._load(self.google_commitments.get(commitment, ""), {})
        record["active"] = False
        record["revoked_at"] = int(self._now())
        self.google_commitments[commitment] = self._dump(record)
        request["google_commitment"] = ""
        request["google_commitment_version"] = ""
        self.requests[str(request_id)] = self._dump(request)

    def _passport_rpc(self, method: str, params: list):
        try:
            response = gl.nondet.web.request(
                self.human_passport_rpc_url,
                method="POST",
                headers={"content-type": "application/json"},
                body=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}),
            )
            status = int(getattr(response, "status_code", getattr(response, "status", 0)))
            if status != 200:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Human Passport RPC HTTP {status}")
            body = response.body.decode("utf-8") if isinstance(response.body, (bytes, bytearray)) else str(response.body)
            if len(body.encode("utf-8")) > MAX_HUMAN_PASSPORT_RESPONSE_BYTES:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} Human Passport RPC response is too large")
            payload = json.loads(body)
            if payload.get("error") is not None:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} Human Passport RPC returned an error")
            return payload.get("result")
        except Exception as error:
            if isinstance(error, gl.vm.UserError):
                raise
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} Human Passport RPC unavailable: {error}")

    def _passport_stable_facts(self, subject: str, block_number: int) -> dict:
        chain_hex = hex(HUMAN_PASSPORT_CHAIN_ID)
        chain_id = self._hex_int(str(self._passport_rpc("eth_chainId", [])), "Human Passport chain ID")
        self._require(chain_id == HUMAN_PASSPORT_CHAIN_ID, "Human Passport RPC is on the wrong chain")
        block_tag = hex(int(block_number))
        block = self._passport_rpc("eth_getBlockByNumber", [block_tag, False])
        self._require(isinstance(block, dict), "Human Passport block was not found")
        self._require(self._hex_int(str(block.get("number", "0x0")), "Human Passport block number") == int(block_number), "Human Passport block number mismatch")
        block_hash = str(block.get("hash", "")).lower()
        block_timestamp = self._hex_int(str(block.get("timestamp", "0x0")), "Human Passport block timestamp")
        self._require(bool(re.match(r"^0x[0-9a-f]{64}$", block_hash)), "Human Passport block hash is malformed")
        code = str(self._passport_rpc("eth_getCode", [self.human_passport_decoder_address, block_tag]) or "")
        self._require(len(code) > 2 and re.match(r"^0x[0-9a-f]+$", code), "Human Passport decoder has no code at the pinned block")
        data = HUMAN_PASSPORT_SCORE_SELECTOR + self._addr(subject)[2:].rjust(64, "0")
        raw = str(self._passport_rpc("eth_call", [{"to": self.human_passport_decoder_address, "data": data}, block_tag]) or "")
        self._require(bool(re.match(r"^0x[0-9a-f]{64}$", raw)), "Human Passport score ABI response is malformed")
        raw_score = int(raw, 16)
        return {
            "wallet": self._addr(subject), "chain_id": chain_id, "decoder": self.human_passport_decoder_address,
            "block_number": int(block_number), "block_hash": block_hash, "block_timestamp": block_timestamp,
            "raw_score": raw_score, "score_scaled": self._score_decimal(raw_score),
        }

    def _hex_body(self, value: str, label: str) -> str:
        clean = str(value or "").strip().lower()
        self._require(bool(re.match(r"^0x[0-9a-f]*$", clean)) and len(clean[2:]) % 2 == 0, f"{label} is not valid hex")
        return clean[2:]

    def _abi_word(self, body: str, byte_offset: int, label: str) -> str:
        self._require(int(byte_offset) >= 0 and int(byte_offset) % 32 == 0, f"{label} offset is malformed")
        start = int(byte_offset) * 2
        self._require(start + 64 <= len(body), f"{label} ABI word is truncated")
        return body[start:start + 64]

    def _abi_uint(self, body: str, byte_offset: int, label: str) -> int:
        try:
            return int(self._abi_word(body, byte_offset, label), 16)
        except Exception:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} {label} is not a valid ABI integer")

    def _abi_address(self, word: str, label: str) -> str:
        clean = str(word or "").lower()
        self._require(bool(re.match(r"^[0-9a-f]{64}$", clean)), f"{label} address word is malformed")
        self._require(clean[:24] == "0" * 24, f"{label} address has non-zero padding")
        return "0x" + clean[24:]

    def _abi_utf8(self, body: str, byte_offset: int, label: str) -> str:
        length = self._abi_uint(body, byte_offset, label + " length")
        start = int(byte_offset) + 32
        end = start + length
        padded_end = start + ((length + 31) // 32) * 32
        self._require(end <= len(body) // 2 and padded_end <= len(body) // 2, f"{label} string is truncated")
        try:
            return bytes.fromhex(body[start * 2:end * 2]).decode("utf-8")
        except Exception:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} {label} is not valid UTF-8")

    def _decode_eas_attestation(self, raw: str) -> dict:
        body = self._hex_body(raw, "Human Passport EAS attestation")
        # EAS Attestation is a tuple of nine static values followed by bytes data.
        self._require(len(body) >= 10 * 64, "Human Passport EAS attestation is truncated")
        data_offset = self._abi_uint(body, 9 * 32, "EAS data")
        data_length = self._abi_uint(body, data_offset, "EAS data")
        data_start = data_offset + 32
        data_end = data_start + data_length
        padded_end = data_start + ((data_length + 31) // 32) * 32
        self._require(padded_end == len(body) // 2, "Human Passport EAS attestation has trailing or missing ABI data")
        revocable = self._abi_uint(body, 5 * 32, "EAS revocable")
        self._require(revocable in (0, 1), "Human Passport EAS revocable flag is malformed")
        return {
            "uid": "0x" + self._abi_word(body, 0, "EAS UID"),
            "schema": "0x" + self._abi_word(body, 32, "EAS schema"),
            "time": self._abi_uint(body, 2 * 32, "EAS creation time"),
            "expiration_time": self._abi_uint(body, 3 * 32, "EAS expiration time"),
            "revocation_time": self._abi_uint(body, 4 * 32, "EAS revocation time"),
            "revocable": bool(revocable),
            "ref_uid": "0x" + self._abi_word(body, 6 * 32, "EAS reference UID"),
            "recipient": self._abi_address(self._abi_word(body, 7 * 32, "EAS recipient"), "EAS recipient"),
            "attester": self._abi_address(self._abi_word(body, 8 * 32, "EAS attester"), "EAS attester"),
            "data": "0x" + body[data_start * 2:data_end * 2],
        }

    def _decode_schema_record(self, raw: str) -> dict:
        body = self._hex_body(raw, "Human Passport schema record")
        self._require(len(body) >= 3 * 64, "Human Passport schema record is truncated")
        schema_offset = self._abi_uint(body, 0, "schema string")
        schema = self._abi_utf8(body, schema_offset, "Human Passport schema")
        schema_length = self._abi_uint(body, schema_offset, "Human Passport schema length")
        schema_end = schema_offset + 32 + schema_length
        padded_end = schema_offset + 32 + ((schema_length + 31) // 32) * 32
        self._require(padded_end == len(body) // 2, "Human Passport schema record has trailing or missing ABI data")
        revocable = self._abi_uint(body, 2 * 32, "schema revocable")
        self._require(revocable in (0, 1), "Human Passport schema revocable flag is malformed")
        return {
            "schema": schema,
            "resolver": self._abi_address(self._abi_word(body, 32, "schema resolver"), "schema resolver"),
            "revocable": bool(revocable),
        }

    def _decode_unified_passport_data(self, raw: str) -> dict:
        body = self._hex_body(raw, "Human Passport unified attestation data")
        self._require(len(body) >= 6 * 64, "Human Passport unified attestation data is truncated")
        passing_word = self._abi_uint(body, 0, "passing_score")
        self._require(passing_word in (0, 1), "passing_score is malformed")
        score_decimals = self._abi_uint(body, 32, "score_decimals")
        scorer_id = self._abi_uint(body, 64, "scorer_id")
        raw_score = self._abi_uint(body, 96, "score")
        threshold = self._abi_uint(body, 128, "threshold")
        stamps_offset = self._abi_uint(body, 160, "stamps")
        self._require(stamps_offset >= 6 * 32, "stamps offset is malformed")
        stamp_count = self._abi_uint(body, stamps_offset, "stamps count")
        self._require(stamp_count <= MAX_HUMAN_PASSPORT_STAMPS, "Human Passport stamp array is too large")
        array_base = stamps_offset + 32
        offsets_end = array_base + (stamp_count * 32)
        self._require(offsets_end <= len(body) // 2, "Human Passport stamp offsets are truncated")
        stamps = []
        array_end = offsets_end
        for index in range(stamp_count):
            element_offset = self._abi_uint(body, array_base + (index * 32), "stamp tuple offset")
            element_start = array_base + element_offset
            self._require(element_start >= offsets_end, "Human Passport stamp tuple overlaps its offset table")
            string_offset = self._abi_uint(body, element_start, "stamp provider offset")
            stamp_score = self._abi_uint(body, element_start + 32, "stamp score")
            provider_start = element_start + string_offset
            provider = self._abi_utf8(body, provider_start, "stamp provider")
            self._require(bool(provider) and len(provider) <= MAX_HUMAN_PASSPORT_PROVIDER_LENGTH, "Human Passport stamp provider is malformed")
            provider_length = self._abi_uint(body, provider_start, "stamp provider length")
            provider_end = provider_start + 32 + provider_length
            provider_padded_end = provider_start + 32 + ((provider_length + 31) // 32) * 32
            self._require(provider_padded_end <= len(body) // 2, "Human Passport stamp provider is truncated")
            array_end = max(array_end, element_start + 64, provider_padded_end)
            stamps.append({"provider": provider, "score": stamp_score})
        self._require(array_end == len(body) // 2, "Human Passport stamp array has trailing or missing ABI data")
        return {
            "passing_score": bool(passing_word),
            "score_decimals": score_decimals,
            "scorer_id": scorer_id,
            "raw_score": raw_score,
            "threshold_raw": threshold,
            "stamps": stamps,
        }

    def _passport_unified_stable_facts(self, subject: str, attestation_uid: str, block_number: int) -> dict:
        uid = self._require_hex_hash(attestation_uid, "Human Passport attestation UID")
        chain_id = self._hex_int(str(self._passport_rpc("eth_chainId", [])), "Human Passport chain ID")
        self._require(chain_id == HUMAN_PASSPORT_CHAIN_ID, "Human Passport RPC is on the wrong chain")
        block_tag = hex(int(block_number))
        block = self._passport_rpc("eth_getBlockByNumber", [block_tag, False])
        self._require(isinstance(block, dict), "Human Passport block was not found")
        self._require(self._hex_int(str(block.get("number", "0x0")), "Human Passport block number") == int(block_number), "Human Passport block number mismatch")
        block_hash = str(block.get("hash", "")).lower()
        block_timestamp = self._hex_int(str(block.get("timestamp", "0x0")), "Human Passport block timestamp")
        self._require(bool(re.match(r"^0x[0-9a-f]{64}$", block_hash)), "Human Passport block hash is malformed")
        for address_value, label in (
            (HUMAN_PASSPORT_EAS_ADDRESS, "Human Passport EAS"),
            (HUMAN_PASSPORT_SCHEMA_REGISTRY_ADDRESS, "Human Passport schema registry"),
            (HUMAN_PASSPORT_UNIFIED_RESOLVER, "Human Passport resolver"),
        ):
            code = str(self._passport_rpc("eth_getCode", [address_value, block_tag]) or "")
            self._require(len(code) > 2 and bool(re.match(r"^0x[0-9a-f]+$", code.lower())), label + " has no code at the pinned block")
        attestation_raw = self._passport_rpc(
            "eth_call",
            [{"to": HUMAN_PASSPORT_EAS_ADDRESS, "data": HUMAN_PASSPORT_GET_ATTESTATION_SELECTOR + uid[2:]}, block_tag],
        )
        attestation = self._decode_eas_attestation(str(attestation_raw or ""))
        self._require(attestation["uid"] == uid, "Human Passport EAS UID mismatch")
        self._require(attestation["schema"] == HUMAN_PASSPORT_UNIFIED_SCHEMA_UID, "Human Passport schema UID is not the approved unified schema")
        self._require(attestation["recipient"] == self._addr(subject), "Human Passport recipient does not match the assessed wallet")
        self._require(attestation["attester"] == HUMAN_PASSPORT_PERMITTED_ATTESTER, "Human Passport attester is not permitted")
        self._require(attestation["revocable"] is True, "Human Passport attestation must be revocable")
        self._require(int(attestation["revocation_time"]) == 0, "Human Passport attestation is revoked at the pinned block")
        self._require(int(attestation["time"]) <= block_timestamp, "Human Passport attestation was created after the pinned block")
        self._require(int(attestation["expiration_time"]) > block_timestamp, "Human Passport attestation was expired at the pinned block")
        schema_raw = self._passport_rpc(
            "eth_call",
            [{"to": HUMAN_PASSPORT_SCHEMA_REGISTRY_ADDRESS, "data": HUMAN_PASSPORT_GET_SCHEMA_SELECTOR + HUMAN_PASSPORT_UNIFIED_SCHEMA_UID[2:]}, block_tag],
        )
        schema = self._decode_schema_record(str(schema_raw or ""))
        self._require(schema["schema"] == HUMAN_PASSPORT_UNIFIED_SCHEMA, "Human Passport schema definition mismatch")
        self._require(schema["resolver"] == HUMAN_PASSPORT_UNIFIED_RESOLVER, "Human Passport schema resolver mismatch")
        self._require(schema["revocable"] is True, "Human Passport schema must be revocable")
        decoded = self._decode_unified_passport_data(attestation["data"])
        self._require(int(decoded["score_decimals"]) == HUMAN_PASSPORT_DECIMALS, "Human Passport score precision mismatch")
        self._require(int(decoded["scorer_id"]) == HUMAN_PASSPORT_APPROVED_SCORER_ID, "Human Passport scorer is not approved")
        self._require(int(decoded["threshold_raw"]) == HUMAN_PASSPORT_THRESHOLD_RAW, "Human Passport attestation threshold mismatch")
        self._require(bool(decoded["passing_score"]) == (int(decoded["raw_score"]) >= int(decoded["threshold_raw"])), "Human Passport passing flag contradicts score and threshold")
        facts = {
            "wallet": self._addr(subject), "chain_id": chain_id, "eas_address": HUMAN_PASSPORT_EAS_ADDRESS,
            "schema_registry": HUMAN_PASSPORT_SCHEMA_REGISTRY_ADDRESS, "schema_uid": attestation["schema"],
            "resolver": schema["resolver"], "attester": attestation["attester"], "attestation_uid": uid,
            "block_number": int(block_number), "block_hash": block_hash, "block_timestamp": block_timestamp,
            "created_at": int(attestation["time"]), "expiration_time": int(attestation["expiration_time"]),
            "revocation_time": int(attestation["revocation_time"]), "revocable": bool(attestation["revocable"]),
            "ref_uid": attestation["ref_uid"], "score_decimals": int(decoded["score_decimals"]),
            "scorer_id": int(decoded["scorer_id"]), "raw_score": int(decoded["raw_score"]),
            "threshold_raw": int(decoded["threshold_raw"]), "passing_score": bool(decoded["passing_score"]),
            "stamps": decoded["stamps"], "data_commitment": self._sha(attestation["data"]),
        }
        facts["evidence_commitment"] = self._sha(self._dump(facts))
        return facts

    @gl.public.write
    def refresh_humanity_evidence_unified(self, request_id: str, attestation_uid: str, block_number: u256) -> str:
        request = self._request(str(request_id))
        self._require(self._sender() == request["subject"], "Only the subject can refresh Human Passport evidence")
        self._require(request["state"] in ("AWAITING_PAYMENT", "FUNDED", "EVALUATING"), "Request is not accepting humanity evidence")
        block = int(block_number)
        self._require(block > 0, "Human Passport block must be positive")

        def leader_fn():
            return self._passport_unified_stable_facts(request["subject"], attestation_uid, block)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return) or not isinstance(leader_result.calldata, dict):
                return False
            try:
                mine = self._passport_unified_stable_facts(request["subject"], attestation_uid, block)
            except Exception:
                return False
            return mine == leader_result.calldata

        try:
            facts = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        except Exception as error:
            if isinstance(error, gl.vm.UserError):
                raise
            raise gl.vm.UserError(f"{ERROR_CONSENSUS} Human Passport unified attestation validators did not agree: {error}")
        self._require(isinstance(facts, dict), "Human Passport unified consensus returned no facts")
        now = int(self._now())
        self._require(int(facts.get("expiration_time", 0) or 0) > now, "Human Passport unified attestation is expired")
        self._require(int(facts.get("block_timestamp", 0) or 0) <= now, "Human Passport evidence block is in the future")
        self._require(now - int(facts.get("block_timestamp", 0) or 0) <= MAX_HUMANITY_SNAPSHOT_AGE_SECONDS, "Human Passport evidence block is stale")
        snapshot = {
            "request_id": request["request_id"], "evidence_type": "eas_unified_v1", "wallet": facts["wallet"],
            "chain_id": facts["chain_id"], "decoder": "", "eas_address": facts["eas_address"],
            "schema_registry": facts["schema_registry"], "schema_uid": facts["schema_uid"],
            "resolver": facts["resolver"], "attester": facts["attester"], "attestation_uid": facts["attestation_uid"],
            "block_number": facts["block_number"], "block_hash": facts["block_hash"], "block_timestamp": facts["block_timestamp"],
            "created_at": facts["created_at"], "expiration_time": facts["expiration_time"],
            "revocation_time": facts["revocation_time"], "revocable": facts["revocable"], "ref_uid": facts["ref_uid"],
            "score_decimals": facts["score_decimals"], "scorer_id": facts["scorer_id"], "raw_score": facts["raw_score"],
            "threshold_raw": facts["threshold_raw"], "passing_score": facts["passing_score"], "stamps": facts["stamps"],
            "data_commitment": facts["data_commitment"], "evidence_commitment": facts["evidence_commitment"],
            "score_scaled": self._score_decimal(int(facts["raw_score"])), "observed_at": now,
            "source": "optimism-sepolia-human-passport-eas-unified",
        }
        self.humanity_snapshots[request["request_id"]] = self._dump(snapshot)
        request["humanity_snapshot_ref"] = request["request_id"]
        self.requests[request["request_id"]] = self._dump(request)
        return self._dump(facts)

    @gl.public.write
    def refresh_humanity_evidence(self, request_id: str, block_number: u256) -> str:
        request = self._request(str(request_id))
        self._require(self._sender() == request["subject"], "Only the subject can refresh Human Passport evidence")
        self._require(request["state"] in ("AWAITING_PAYMENT", "FUNDED", "EVALUATING"), "Request is not accepting humanity evidence")
        block = int(block_number)
        self._require(block > 0, "Human Passport block must be positive")
        def leader_fn():
            return self._passport_stable_facts(request["subject"], block)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return) or not isinstance(leader_result.calldata, dict):
                return False
            try:
                return self._passport_stable_facts(request["subject"], block) == leader_result.calldata
            except Exception:
                return False

        try:
            facts = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        except Exception as error:
            if isinstance(error, gl.vm.UserError):
                raise
            raise gl.vm.UserError(f"{ERROR_CONSENSUS} Human Passport validators did not agree: {error}")
        self._require(isinstance(facts, dict), "Human Passport consensus returned no facts")
        self.humanity_snapshots[request["request_id"]] = self._dump({
            "request_id": request["request_id"], "wallet": facts["wallet"], "chain_id": facts["chain_id"],
            "decoder": facts["decoder"], "block_number": facts["block_number"], "block_hash": facts["block_hash"],
            "block_timestamp": facts["block_timestamp"], "raw_score": facts["raw_score"],
            "score_scaled": facts["score_scaled"], "observed_at": int(self._now()),
            "source": "optimism-sepolia-human-passport-decoder",
        })
        request["humanity_snapshot_ref"] = request["request_id"]
        self.requests[request["request_id"]] = self._dump(request)
        return self._dump(facts)

    @gl.public.view
    def get_humanity_evidence(self, request_id: str) -> dict:
        snapshot = self._load(self.humanity_snapshots.get(str(request_id), ""), None)
        return snapshot if isinstance(snapshot, dict) else {"found": False}

    # ------------------------------------------------------------------
    # Assessment, settlement, refund state transitions
    # ------------------------------------------------------------------

    @gl.public.write
    def confirm_arc_payment(self, request_id: str, arc_tx_hash: str, arc_log_index: u256) -> None:
        request = self._request(str(request_id))
        self._require(request["state"] == "AWAITING_PAYMENT", "Request is not awaiting payment")
        self._require(self._sender() == request["payer"], "Only the payer can bind an Arc payment")
        self._require(bool(request.get("consent_nonce")) and int(request.get("consent_expires_at", 0) or 0) > 0, "Valid subject consent is required before payment")
        self._require(int(request.get("payment_intent_expires_at", 0) or 0) == int(request.get("consent_expires_at", 0) or 0), "Payment intent is not bound to consent")
        tx_hash = self._normalize_tx_hash(arc_tx_hash)
        key = str(ARC_CHAIN_ID) + ":" + tx_hash + ":" + str(int(arc_log_index))
        self._require(self.consumed_arc_payments.get(key) is None, "Arc payment receipt has already been consumed")
        payment = self._verify_event(tx_hash, int(arc_log_index), PAYMENT_DEPOSITED_TOPIC, request, "deposit")
        self.consumed_arc_payments[key] = True
        request["arc_tx_hash"] = tx_hash
        request["arc_log_index"] = int(arc_log_index)
        request["arc_deposit_block_number"] = int(payment.get("block_number", 0) or 0)
        request["payment_state"] = "ESCROWED"
        request["state"] = "FUNDED"
        request["funded_at"] = int(self._now())
        # The service/refund clock starts when funds actually enter escrow,
        # not when an unpaid request was created.  This keeps the requester’s
        # recovery window bounded to the deposit itself and avoids a late
        # payment losing part of the promised 72-hour delivery period.
        request["assessment_deadline"] = int(request["funded_at"]) + ASSESSMENT_DEADLINE_SECONDS
        request["refund_available_at"] = int(request["funded_at"]) + ASSESSMENT_DEADLINE_SECONDS
        self.requests[str(request_id)] = self._dump(request)

    @gl.public.write
    def evaluate_assessment(self, request_id: str) -> str:
        request = self._request(str(request_id))
        self._require(request["state"] == "FUNDED", "Request is not funded")
        policy = self._policy(request["policy_id"])
        now = int(self._now())
        self._require(now <= int(request["assessment_deadline"]), "Assessment execution deadline has passed")
        # Cross-contract V3 reads are deterministic and happen before the
        # nondeterministic evidence/LLM block.  Validators receive the exact
        # V3 snapshot and independently recompute every decision field.
        v3_snapshot = self._read_v3(request["subject"])

        def leader_fn():
            facts = self._assessment_facts(request, policy, now, v3_snapshot)
            prompt = f"""Return strict JSON only for the SoulStamp V4 TrustPass assessment.
Fields: outcome, reasoning. Allowed outcome: PASS, FAIL, INCONCLUSIVE.
Protocol facts are authoritative and must not be changed: {self._dump(facts)}
Explain the result without exposing private Google identifiers, tokens, or raw personal data.
"""
            ai = gl.nondet.exec_prompt(prompt, response_format="json")
            reasoning = str(ai.get("reasoning", "") if isinstance(ai, dict) else "").strip()[:MAX_REASON_LENGTH]
            return {
                "outcome": facts["outcome"], "reason_code": facts["reason_code"],
                "facts": facts, "reasoning": reasoning,
            }

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return) or not isinstance(leader_result.calldata, dict):
                return False
            try:
                mine_facts = self._assessment_facts(request, policy, now, v3_snapshot)
                ai = gl.nondet.exec_prompt(
                    f"Independent reviewer: summarize the following fixed TrustPass facts as JSON with a reasoning string only. Facts={self._dump(mine_facts)}",
                    response_format="json",
                )
                if not isinstance(ai, dict):
                    return False
            except Exception:
                return False
            data = leader_result.calldata
            return (
                data.get("outcome") == mine_facts.get("outcome")
                and data.get("reason_code") == mine_facts.get("reason_code")
                and data.get("facts") == mine_facts
            )

        try:
            result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        except Exception as error:
            if isinstance(error, gl.vm.UserError):
                raise
            raise gl.vm.UserError(f"{ERROR_CONSENSUS} Assessment validators did not agree: {error}")
        self._require(isinstance(result, dict), "Assessment consensus returned no decision")
        outcome = str(result.get("outcome", "")).upper()
        self._require(outcome in OUTCOMES, "Assessment outcome is invalid")
        self.pass_nonce = u256(int(self.pass_nonce) + 1)
        assessment_id = hashlib.sha256(f"SOULSTAMP-V4-ASSESSMENT:{request_id}:{int(self.pass_nonce)}".encode()).hexdigest().upper()
        request["assessment_id"] = assessment_id
        request["proposed_outcome"] = outcome
        request["reason_code"] = str(result.get("reason_code", "")).strip()[:128]
        request["reasoning"] = str(result.get("reasoning", "")).strip()[:MAX_REASON_LENGTH]
        request["evaluated_at"] = now
        request["state"] = "EVALUATED_PENDING_SETTLEMENT"
        self.requests[str(request_id)] = self._dump(request)
        self.total_assessments = u256(int(self.total_assessments) + 1)
        return self._dump({"assessment_id": assessment_id, "outcome": outcome, "reason_code": request["reason_code"], "state": request["state"]})

    @gl.public.write
    def settle_assessment(self, request_id: str, arc_settlement_tx_hash: str, arc_log_index: u256) -> None:
        request = self._request(str(request_id))
        self._require(request["state"] == "EVALUATED_PENDING_SETTLEMENT", "Assessment is not awaiting settlement")
        self._require(self._sender() == self.settlement_operator, "Only the configured settlement operator can bind Arc settlement")
        tx_hash = self._normalize_tx_hash(arc_settlement_tx_hash)
        event = self._verify_event(tx_hash, int(arc_log_index), PAYMENT_SETTLED_TOPIC, request, "settlement")
        commitment = self._sha(f"SOULSTAMP-V4-RESULT:{request['request_id']}:{request['assessment_id']}:{request['proposed_outcome']}:{request['policy_hash']}")
        self._require(event.get("result_commitment") == commitment, "Arc settlement result commitment mismatch")
        request["arc_settlement_tx_hash"] = tx_hash
        request["arc_settlement_log_index"] = int(arc_log_index)
        request["payment_state"] = "SETTLED"
        request["settled_at"] = int(self._now())
        outcome = request["proposed_outcome"]
        request["state"] = "ACTIVE" if outcome == "PASS" else ("COMPLETED_FAIL" if outcome == "FAIL" else "COMPLETED_INCONCLUSIVE")
        # Disabling a policy stops new requests and future consumer use; it
        # must not prevent an already-funded assessment from completing its
        # immutable, paid terms.  Settlement still reuses the stored policy
        # hash/version and cannot rewrite them.
        policy_for_settlement = self._policy_record(request["policy_id"], require_enabled=False)
        lifetime = min(TRUSTPASS_MAX_LIFETIME_SECONDS, int(policy_for_settlement.get("maximum_trustpass_lifetime_seconds", TRUSTPASS_MAX_LIFETIME_SECONDS)))
        request["expires_at"] = int(request["settled_at"]) + lifetime
        pass_record = {
            "assessment_id": request["assessment_id"], "request_id": request["request_id"], "state": request["state"],
            "outcome": outcome, "reason_code": request["reason_code"], "reasoning": request["reasoning"],
            "requester": request["requester"], "payer": request["payer"], "subject": request["subject"],
            "policy_id": request["policy_id"], "policy_version": request["policy_version"], "policy_hash": request["policy_hash"],
            "created_at": request["created_at"], "assessed_at": request["evaluated_at"], "settled_at": request["settled_at"],
            "expires_at": request["expires_at"], "arc_payment_tx_hash": request["arc_tx_hash"],
            "arc_settlement_tx_hash": tx_hash, "v3_contract_address": self.v3_contract_address,
            "v4_contract_version": CONTRACT_VERSION, "invalidated": False,
            "humanity_snapshot": self.humanity_snapshots.get(request["request_id"], ""),
            "google_commitment": request.get("google_commitment", ""),
        }
        self.trustpasses[request["assessment_id"]] = self._dump(pass_record)
        self.pass_ids.append(request["assessment_id"])
        self.settlement_records[request["request_id"]] = self._dump({"tx_hash": tx_hash, "log_index": int(arc_log_index), "assessment_id": request["assessment_id"], "outcome": outcome, "verified_at": int(request["settled_at"])})
        self.requests[str(request_id)] = self._dump(request)
        self.total_settlements = u256(int(self.total_settlements) + 1)
        if outcome == "PASS":
            self.total_passes = u256(int(self.total_passes) + 1)

    @gl.public.write
    def confirm_arc_refund(self, request_id: str, arc_refund_tx_hash: str, arc_log_index: u256) -> None:
        request = self._request(str(request_id))
        self._require(request["state"] in ("FUNDED", "EVALUATED_PENDING_SETTLEMENT", "UNDELIVERABLE", "EXPIRED"), "Request cannot be refunded")
        self._require(request["payment_state"] == "ESCROWED", "Payment is not escrowed")
        tx_hash = self._normalize_tx_hash(arc_refund_tx_hash)
        event = self._verify_event(tx_hash, int(arc_log_index), PAYMENT_REFUNDED_TOPIC, request, "refund")
        request["arc_refund_tx_hash"] = tx_hash
        request["arc_refund_log_index"] = int(arc_log_index)
        request["payment_state"] = "REFUNDED"
        request["state"] = "REFUNDED"
        self.requests[str(request_id)] = self._dump(request)
        self.total_refunds = u256(int(self.total_refunds) + 1)

    @gl.public.write
    def expire_request(self, request_id: str) -> None:
        request = self._request(str(request_id))
        now = int(self._now())
        if request["state"] == "AWAITING_CONSENT":
            deadline = int(request["consent_deadline"])
        elif request["state"] == "AWAITING_PAYMENT":
            deadline = int(request["payment_intent_expires_at"])
        else:
            deadline = int(request["assessment_deadline"])
        self._require(now > deadline, "Request deadline has not elapsed")
        self._require(request["state"] in ("AWAITING_CONSENT", "AWAITING_PAYMENT", "FUNDED", "EVALUATED_PENDING_SETTLEMENT"), "Request is not expirable")
        request["state"] = "UNDELIVERABLE" if request["payment_state"] == "ESCROWED" else "EXPIRED"
        self.requests[str(request_id)] = self._dump(request)

    @gl.public.write
    def invalidate_trustpass(self, assessment_id: str, reason: str) -> None:
        self._require(self._sender() == self.admin, "Only the admin can invalidate a TrustPass")
        record = self._load(self.trustpasses.get(str(assessment_id), ""), None)
        self._require(isinstance(record, dict), "TrustPass not found")
        record["invalidated"] = True
        record["invalidity_reason"] = str(reason or "ADMIN_INVALIDATED")[:MAX_REASON_LENGTH]
        self.trustpasses[str(assessment_id)] = self._dump(record)
        self.invalidated_passes[str(assessment_id)] = record["invalidity_reason"]

    # ------------------------------------------------------------------
    # Consumer interfaces
    # ------------------------------------------------------------------

    def _pass_eligibility(self, record: dict, policy_id: str, subject: str) -> dict:
        now = int(self._now())
        if not record:
            return {"eligible": False, "reason": "NO_ASSESSMENT"}
        if str(record.get("subject", "")).lower() != self._addr(subject):
            return {"eligible": False, "reason": "SUBJECT_MISMATCH"}
        if str(record.get("policy_id", "")) != str(policy_id):
            return {"eligible": False, "reason": "POLICY_MISMATCH"}
        if record.get("outcome") != "PASS":
            return {"eligible": False, "reason": "ASSESSMENT_NOT_PASS"}
        if record.get("state") != "ACTIVE":
            return {"eligible": False, "reason": "ASSESSMENT_NOT_ACTIVE"}
        if bool(record.get("invalidated")):
            return {"eligible": False, "reason": "ASSESSMENT_INVALIDATED"}
        if int(record.get("expires_at", 0) or 0) < now:
            return {"eligible": False, "reason": "ASSESSMENT_EXPIRED"}
        if not record.get("arc_settlement_tx_hash"):
            return {"eligible": False, "reason": "PAYMENT_UNSETTLED"}
        policy = self._load(self.policies.get(str(policy_id), ""), {})
        if not policy.get("enabled") or self._policy_hash(policy) != str(record.get("policy_hash", "")):
            return {"eligible": False, "reason": "POLICY_NOT_AUTHORIZED"}
        v3 = self._read_v3(self._addr(subject))
        if not v3.get("available"):
            return {"eligible": False, "reason": "V3_READ_UNAVAILABLE"}
        if not v3.get("eligible") or v3.get("identity_state") != "ACTIVE" or v3.get("is_flagged"):
            return {"eligible": False, "reason": "V3_IDENTITY_NOT_ELIGIBLE"}
        # A general V3 eligibility result is not sufficient: a policy may
        # require only a subset of credentials, and every one of those
        # credentials must still be ACTIVE, fresh under V3's dossier expiry,
        # and strong enough for this policy at the moment of consumption.
        social_required = [
            ("twitter" if str(credential).lower() == "x" else str(credential).lower())
            for credential in policy.get("required_credentials", [])
            if str(credential).lower() != "google"
        ]
        credential_facts = self._credential_facts(v3, {**policy, "required_credentials": social_required}, now)
        for credential in social_required:
            if not credential_facts.get(credential, {}).get("acceptable"):
                return {"eligible": False, "reason": "REQUIRED_CREDENTIAL_" + credential.upper() + "_INVALID"}
        if "google" in policy.get("required_credentials", []):
            google = self._google_facts({"subject": self._addr(subject), "google_commitment": record.get("google_commitment", "")}, now)
            if not google.get("valid"):
                return {"eligible": False, "reason": google.get("reason", "GOOGLE_EVIDENCE_INVALID")}
        if bool(policy.get("external_humanity_required")):
            humanity = self._humanity_facts({"request_id": record.get("request_id", ""), "subject": self._addr(subject)}, policy, now)
            if not humanity.get("valid"):
                return {"eligible": False, "reason": humanity.get("reason", "HUMANITY_EVIDENCE_INVALID")}
        return {"eligible": True, "reason": "TRUSTPASS_ACTIVE", "assessment_id": record.get("assessment_id", ""), "checked_at": now}

    @gl.public.view
    def get_request(self, request_id: str) -> dict:
        request = self._load(self.requests.get(str(request_id), ""), None)
        return request if isinstance(request, dict) else {"found": False}

    @gl.public.view
    def get_requests(self, wallet: str, offset: u32 = u32(0), limit: u32 = u32(50)) -> list:
        subject = self._addr(wallet)
        result = []
        for index in range(int(offset), len(self.request_ids)):
            request = self._load(self.requests.get(self.request_ids[index], ""), {})
            if str(request.get("subject", "")).lower() == subject or str(request.get("requester", "")).lower() == subject:
                result.append(request)
                if len(result) >= min(int(limit), 100):
                    break
        return result

    @gl.public.view
    def get_trustpass(self, pass_id: str) -> dict:
        record = self._load(self.trustpasses.get(str(pass_id), ""), None)
        return record if isinstance(record, dict) else {"found": False}

    @gl.public.view
    def get_trustpasses(self, wallet: str, offset: u32 = u32(0), limit: u32 = u32(50)) -> list:
        subject = self._addr(wallet)
        result = []
        for index in range(int(offset), len(self.pass_ids)):
            record = self._load(self.trustpasses.get(self.pass_ids[index], ""), {})
            if str(record.get("subject", "")).lower() == subject:
                result.append(record)
                if len(result) >= min(int(limit), 100):
                    break
        return result

    @gl.public.view
    def check_trustpass(self, pass_id: str, policy_id: str, subject: str) -> dict:
        record = self._load(self.trustpasses.get(str(pass_id), ""), {})
        return self._pass_eligibility(record, policy_id, subject)

    @gl.public.view
    def consumer_eligibility(self, subject: str, policy_id: str = "") -> dict:
        wallet = self._addr(subject)
        for pass_id in self.pass_ids:
            record = self._load(self.trustpasses.get(pass_id, ""), {})
            if str(record.get("subject", "")).lower() != wallet or record.get("outcome") != "PASS":
                continue
            policy = policy_id or str(record.get("policy_id", ""))
            result = self._pass_eligibility(record, policy, wallet)
            if result.get("eligible"):
                result["subject"] = wallet
                result["policy_id"] = policy
                return result
        return {"eligible": False, "reason": "NO_CURRENT_PASS", "subject": wallet, "policy_id": policy_id}

    @gl.public.view
    def is_eligible(self, subject: str, policy_id: str = "") -> bool:
        return bool(self.consumer_eligibility(subject, policy_id).get("eligible"))

    @gl.public.view
    def get_payment_status(self, request_id: str) -> dict:
        request = self._request(str(request_id))
        return {
            "request_id": request["request_id"], "state": request["state"], "payment_state": request["payment_state"],
            "arc_tx_hash": request.get("arc_tx_hash", ""), "arc_settlement_tx_hash": request.get("arc_settlement_tx_hash", ""),
            "arc_refund_tx_hash": request.get("arc_refund_tx_hash", ""),
            "arc_log_index": int(request.get("arc_log_index", -1)),
            "arc_refund_log_index": int(request.get("arc_refund_log_index", -1)),
            "original_payer": request.get("payer", ""),
            "consent_expires_at": int(request.get("consent_expires_at", 0) or 0),
            "refund_available_at": int(request.get("refund_available_at", 0) or 0),
            "amount_usdc_base_units": ASSESSMENT_PRICE_USDC,
        }

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "contract_version": CONTRACT_VERSION, "verifier_version": VERIFIER_VERSION,
            "contract_address": self._addr(self_address()),
            "admin": self.admin, "v3_contract_address": self.v3_contract_address,
            "arc_escrow_address": self.arc_escrow_address, "settlement_operator": self.settlement_operator,
            "google_attestation_base_url": self.google_attestation_base_url,
            "human_passport_chain_id": HUMAN_PASSPORT_CHAIN_ID,
            "human_passport_decoder_address": self.human_passport_decoder_address,
            "human_passport_rpc_url": self.human_passport_rpc_url,
            "human_passport_threshold_raw": HUMAN_PASSPORT_THRESHOLD_RAW,
            "human_passport_score_decimals": HUMAN_PASSPORT_DECIMALS,
            "human_passport_evidence_mode": "EAS_UNIFIED_V1_WITH_LEGACY_FALLBACK",
            "human_passport_eas_address": HUMAN_PASSPORT_EAS_ADDRESS,
            "human_passport_schema_registry": HUMAN_PASSPORT_SCHEMA_REGISTRY_ADDRESS,
            "human_passport_unified_schema_uid": HUMAN_PASSPORT_UNIFIED_SCHEMA_UID,
            "human_passport_unified_resolver": HUMAN_PASSPORT_UNIFIED_RESOLVER,
            "human_passport_permitted_attester": HUMAN_PASSPORT_PERMITTED_ATTESTER,
            "human_passport_approved_scorer_id": HUMAN_PASSPORT_APPROVED_SCORER_ID,
            "v3_contract_version": V3_CONTRACT_VERSION,
            "assessment_price_usdc": ASSESSMENT_PRICE_USDC, "usdc_decimals": USDC_DECIMALS,
            "total_policies": int(self.total_policies), "total_requests": int(self.total_requests),
            "total_assessments": int(self.total_assessments), "total_passes": int(self.total_passes),
            "total_settlements": int(self.total_settlements), "total_refunds": int(self.total_refunds),
            "request_states": REQUEST_STATES, "outcomes": OUTCOMES,
        }


def self_address() -> str:
    """GenLayer supplies the active contract address through this helper."""
    try:
        return str(gl.message.contract_address)
    except Exception:
        # Direct Mode versions that do not expose contract_address still
        # provide a stable placeholder for hashes; deployment validates the
        # constructor-bound address independently.
        return "0x" + "00" * 20
