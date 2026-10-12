# v0.3.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""SoulStamp identity continuity and recovery protocol.

The contract is the authority for canonical platform ownership and uniqueness,
fresh evidence, proof health, consumer eligibility, challenges, rebuttals,
recovery, append-only audit history, and migration from the v2 contract.
"""

from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import re
from urllib.parse import quote, urlparse


SUPPORTED_PLATFORMS = ["github", "twitter", "discord"]
PROOF_STATUSES = ["ACTIVE", "STALE", "REVOKED", "CONFLICTED", "FLAGGED", "RECOVERED"]
PROOF_STRENGTHS = ["STRONG", "MEDIUM", "WEAK"]
RISK_BANDS = ["low", "medium", "high"]
CHALLENGE_STATUSES = [
    "OPEN", "AWAITING_REBUTTAL", "RESPONDED", "RESOLVED_OWNER",
    "RESOLVED_CHALLENGER", "RESOLVED_INCONCLUSIVE", "EXECUTED", "EXPIRED",
]
CONFIDENCE_THRESHOLD = 65
BOT_FLAG_THRESHOLD = 75
MAX_ACCOUNTS_PER_ADDRESS = 10
PENDING_TTL_SECONDS = 30 * 60
PROOF_VALIDITY_SECONDS = 30 * 24 * 60 * 60
CHALLENGE_RESPONSE_WINDOW_SECONDS = 30 * 60
RECOVERY_DELAY_SECONDS = 60
VERIFIER_VERSION = "soulstamp-v3.0-continuity"
ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"


@allow_storage
@dataclass
class ProofDossier:
    platform: str
    username: str
    canonical_platform_id: str
    proof_url: str
    verification_code: str
    pending_id: str
    proof_strength: str
    risk_band: str
    confidence_bucket: u32
    reason_code: str
    proof_status: str
    verification_method: str
    verifier_version: str
    audit_ref: u32
    verified_wallet: str
    created_marker: u256
    updated_marker: u256
    evidence_issued_at: u256
    evidence_expires_at: u256


@allow_storage
@dataclass
class LinkedAccount:
    platform: str
    username: str
    profile_url: str
    verified_at: u256
    confidence_score: u32
    bot_score: u32
    reasoning: str
    is_active: bool
    proof_status: str
    proof_strength: str
    risk_band: str
    canonical_platform_id: str
    verification_code: str
    pending_id: str
    proof_url: str
    reason_code: str
    last_checked_marker: u256
    dossier: ProofDossier
    status_before_flag: str


@allow_storage
@dataclass
class PendingVerification:
    platform: str
    username: str
    profile_url: str
    verification_code: str
    pending_id: str
    request_nonce: u32
    requested_at: u256
    expires_at: u256
    wallet: str


@allow_storage
@dataclass
class AuditEntry:
    action: str
    platform: str
    username: str
    result: str
    confidence: u32
    bot_score: u32
    timestamp: u256
    proof_status: str
    reason_code: str
    actor: str
    details: str
    previous_hash: str
    event_hash: str


@allow_storage
@dataclass
class IdentityRecord:
    owner: str
    linked_accounts: DynArray[LinkedAccount]
    reputation_score: u32
    is_flagged: bool
    flag_reason: str
    created_at: u256
    last_updated: u256
    verification_count: u32
    audit_log: DynArray[AuditEntry]
    principal_id: str
    identity_state: str
    recovery_target: str


@allow_storage
@dataclass
class OwnershipChallenge:
    challenge_id: str
    platform: str
    username: str
    canonical_platform_id: str
    current_owner: str
    challenger_wallet: str
    challenger_code: str
    owner_rebuttal_code: str
    challenger_evidence_url: str
    owner_rebuttal_url: str
    owner_rebuttal_statement: str
    challenger_evidence_status: str
    owner_evidence_status: str
    challenger_canonical_id: str
    owner_canonical_id: str
    opened_at: u256
    rebuttal_deadline: u256
    resolved_at: u256
    recovery_not_before: u256
    status: str
    outcome: str
    reason_code: str
    resolution_reasoning: str
    recovery_executed_at: u256


class SoulStamp(gl.Contract):
    """Single-principal SoulStamp continuity contract."""

    identities: TreeMap[str, IdentityRecord]
    pending_verifications: TreeMap[str, PendingVerification]
    platform_to_address: TreeMap[str, str]
    canonical_id_to_address: TreeMap[str, str]
    used_discord_attestations: TreeMap[str, bool]
    all_addresses: DynArray[str]
    challenges: TreeMap[str, OwnershipChallenge]
    all_challenge_ids: DynArray[str]
    open_challenges_by_platform: TreeMap[str, str]
    latest_challenge_by_wallet: TreeMap[str, str]
    wallet_to_principal: TreeMap[str, str]
    principal_to_wallet: TreeMap[str, str]
    admin: str
    total_verifications: u32
    total_identities: u32
    total_challenges: u32
    total_recoveries: u32
    request_nonce: u32
    event_marker: u256
    discord_attestation_base_url: str
    legacy_contract_address: str

    def __init__(self, admin_address: str = "", legacy_contract_address: str = "") -> None:
        admin = admin_address or str(gl.message.sender_address)
        if not self._valid_address(admin):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} admin_address must be a valid 0x-prefixed address")
        self.admin = self._addr(admin)
        self.total_verifications = u32(0)
        self.total_identities = u32(0)
        self.total_challenges = u32(0)
        self.total_recoveries = u32(0)
        self.request_nonce = u32(0)
        self.event_marker = u256(0)
        self.discord_attestation_base_url = ""
        self.legacy_contract_address = self._addr(legacy_contract_address) if legacy_contract_address else ""

    def _addr(self, address) -> str:
        return str(address).lower().strip()

    def _valid_address(self, address: str) -> bool:
        return bool(re.match(r"^0x[0-9a-fA-F]{40}$", str(address).strip()))

    def _now(self) -> u256:
        # GenVM pins datetime.now() to the transaction context.
        return u256(int(datetime.now(timezone.utc).timestamp()))

    def _mark(self) -> u256:
        self.event_marker = u256(int(self.event_marker) + 1)
        return self.event_marker

    def _require(self, condition: bool, message: str) -> None:
        if not condition:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {message}")

    def _normalize_platform(self, platform: str) -> str:
        p = str(platform).lower().strip()
        if p == "x":
            return "twitter"
        if p in ("discordapp", "discord_app"):
            return "discord"
        return p

    def _normalize_username(self, platform: str, username: str) -> str:
        return str(username).strip().lstrip("@")

    def _platform_key(self, platform: str, username: str) -> str:
        return f"{platform}:{self._normalize_username(platform, username).lower()}"

    def _canonical_key(self, platform: str, canonical_id: str) -> str:
        return f"{platform}:{str(canonical_id).strip().lower()}"

    def _make_pending_id(self, caller: str, platform: str, username: str, nonce: u32) -> str:
        raw = f"SOULSTAMP-V3:{caller}:{platform}:{username.lower().strip()}:{int(nonce)}"
        return hashlib.sha256(raw.encode()).hexdigest()[:24].upper()

    def _make_code(self, pending_id: str) -> str:
        return f"SOULSTAMP-VERIFY-{pending_id[:12]}"

    def _make_challenge_code(self, prefix: str, challenge_id: str) -> str:
        return f"SOULSTAMP-{prefix}-{challenge_id[:12]}"

    def _principal_id(self, wallet: str) -> str:
        return hashlib.sha256(f"SOULSTAMP-PRINCIPAL:{wallet}".encode()).hexdigest()[:32].upper()

    def _create_identity(self, wallet: str, marker: u256) -> IdentityRecord:
        principal = self._principal_id(wallet)
        identity = IdentityRecord(
            owner=wallet,
            linked_accounts=[],
            reputation_score=u32(0),
            is_flagged=False,
            flag_reason="",
            created_at=marker,
            last_updated=marker,
            verification_count=u32(0),
            audit_log=[],
            principal_id=principal,
            identity_state="ACTIVE",
            recovery_target="",
        )
        self.all_addresses.append(wallet)
        self.wallet_to_principal[wallet] = principal
        self.principal_to_wallet[principal] = wallet
        self.total_identities = u32(int(self.total_identities) + 1)
        return identity

    def _hash_event(self, previous: str, action: str, actor: str, details: str, marker: u256) -> str:
        return hashlib.sha256(f"{previous}|{action}|{actor}|{details}|{int(marker)}".encode()).hexdigest()

    def _append_audit(
        self, identity: IdentityRecord, action: str, platform: str, username: str,
        result: str, confidence: int, bot_score: int, proof_status: str,
        reason_code: str, details: str = "", actor: str = "",
    ) -> u32:
        marker = self._mark()
        previous = identity.audit_log[-1].event_hash if len(identity.audit_log) > 0 else ""
        actor_value = actor or self._addr(gl.message.sender_address)
        event_hash = self._hash_event(previous, action, actor_value, details, marker)
        identity.audit_log.append(AuditEntry(
            action=action, platform=platform, username=username, result=result,
            confidence=u32(max(0, min(100, confidence))),
            bot_score=u32(max(0, min(100, bot_score))), timestamp=marker,
            proof_status=proof_status, reason_code=reason_code, actor=actor_value,
            details=details, previous_hash=previous, event_hash=event_hash,
        ))
        return u32(len(identity.audit_log))

    def _find_account(self, identity: IdentityRecord, platform: str, username: str) -> int:
        target = self._normalize_username(platform, username).lower()
        idx = 0
        for acct in identity.linked_accounts:
            if acct.platform == platform and acct.username.lower() == target:
                return idx
            idx += 1
        return -1

    def _is_active_account(self, acct: LinkedAccount, now: u256 = u256(0)) -> bool:
        current = now if int(now) > 0 else self._now()
        return acct.is_active and acct.proof_status == "ACTIVE" and int(acct.dossier.evidence_expires_at) >= int(current)

    def _set_account_status(self, acct: LinkedAccount, status: str, reason: str, marker: u256) -> None:
        self._require(status in PROOF_STATUSES, f"Invalid proof status '{status}'")
        acct.proof_status = status
        acct.is_active = status == "ACTIVE"
        acct.reason_code = reason
        acct.last_checked_marker = marker
        acct.dossier.proof_status = status
        acct.dossier.reason_code = reason
        acct.dossier.updated_marker = marker

    def _remove_indexes(self, owner: str, acct: LinkedAccount) -> None:
        pkey = self._platform_key(acct.platform, acct.username)
        if self.platform_to_address.get(pkey) == owner:
            del self.platform_to_address[pkey]
        if acct.canonical_platform_id:
            ckey = self._canonical_key(acct.platform, acct.canonical_platform_id)
            if self.canonical_id_to_address.get(ckey) == owner:
                del self.canonical_id_to_address[ckey]

    def _reserve_indexes(self, owner: str, acct: LinkedAccount) -> None:
        self._require(bool(acct.canonical_platform_id), "Fresh evidence did not include a canonical platform ID")
        pkey = self._platform_key(acct.platform, acct.username)
        existing_owner = self.platform_to_address.get(pkey)
        self._require(existing_owner is None or existing_owner == owner, "Platform account is already linked to another wallet")
        ckey = self._canonical_key(acct.platform, acct.canonical_platform_id)
        existing_canonical_owner = self.canonical_id_to_address.get(ckey)
        self._require(existing_canonical_owner is None or existing_canonical_owner == owner, "Canonical platform ID is already linked to another wallet")
        self.platform_to_address[pkey] = owner
        self.canonical_id_to_address[ckey] = owner

    def _target_url(self, platform: str, username: str, fetch_url: str) -> str:
        clean_username = self._normalize_username(platform, username)
        username_lc = clean_username.lower()
        if platform == "github":
            if fetch_url:
                parsed = urlparse(fetch_url)
                self._require(parsed.scheme == "https" and parsed.netloc.lower() == "github.com" and parsed.path.strip("/").lower() == username_lc, "GitHub evidence must be the claimed public profile URL")
            return f"https://api.github.com/users/{clean_username}"
        if platform == "twitter":
            self._require(bool(fetch_url), "X verification requires a public post URL")
            parsed = urlparse(fetch_url)
            host = parsed.netloc.lower().split(":")[0]
            parts = [p for p in parsed.path.split("/") if p]
            self._require(parsed.scheme == "https" and host in ("x.com", "twitter.com") and len(parts) >= 3 and parts[0].lower() == username_lc and parts[1].lower() == "status" and bool(re.match(r"^[0-9]+$", parts[2])), "X evidence URL must be a status authored by the claimed handle")
            tweet_url = f"https://twitter.com/i/status/{parts[2]}"
            return f"https://publish.twitter.com/oembed?url={quote(tweet_url, safe='')}&dnt=true&omit_script=true"
        if platform == "discord":
            self._require(bool(fetch_url), "Discord verification requires a fresh attestation URL")
            base = self.discord_attestation_base_url.rstrip("/")
            self._require(bool(base), "Discord attestation backend is not configured")
            prefix = f"{base}/api/discord/attestations/"
            self._require(fetch_url.startswith(prefix), "Discord attestation URL is not from the configured backend")
            token = fetch_url[len(prefix):].strip()
            self._require(bool(token) and "/" not in token, "Discord attestation URL is malformed")
            self._require(self.used_discord_attestations.get(token) is None, "Discord attestation has already been used")
            return fetch_url
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Unsupported platform '{platform}'")

    def _empty_dossier(self, platform: str, username: str, proof_url: str, code: str, pending_id: str, wallet: str, marker: u256) -> ProofDossier:
        return ProofDossier(
            platform=platform, username=username, canonical_platform_id="", proof_url=proof_url,
            verification_code=code, pending_id=pending_id, proof_strength="WEAK", risk_band="medium",
            confidence_bucket=u32(0), reason_code="PENDING", proof_status="STALE",
            verification_method="genlayer-web-consensus", verifier_version=VERIFIER_VERSION,
            audit_ref=u32(0), verified_wallet=wallet, created_marker=marker, updated_marker=marker,
            evidence_issued_at=u256(0), evidence_expires_at=u256(0),
        )

    # ── Evidence and independent GenLayer resolution ──────────────────────────

    def _coerce_verdict(self, value, platform: str, username: str, code: str, content: str, fallback_status: str, expected_canonical_id: str, evidence_issued_at: int = 0, evidence_expires_at: int = 0) -> dict:
        if not isinstance(value, dict):
            raise gl.vm.UserError(f"{ERROR_LLM} GenLayer proof verdict was not structured JSON")
        code_found = bool(value.get("code_found", code in content))
        account_match = bool(value.get("account_match", False))
        canonical_id = str(value.get("canonical_platform_id", "") or "").strip()
        if expected_canonical_id and canonical_id and canonical_id != expected_canonical_id:
            raise gl.vm.UserError(f"{ERROR_LLM} GenLayer verdict changed the canonical platform ID")
        canonical_id = expected_canonical_id or canonical_id
        risk_band = str(value.get("risk_band", "medium") or "medium").strip().lower()
        proof_strength = str(value.get("proof_strength", "WEAK") or "WEAK").strip().upper()
        reason_code = str(value.get("reason_code", "") or "").strip().upper()
        try:
            confidence = int(value.get("confidence_bucket", 0))
        except Exception:
            confidence = 0
        fresh = not (platform == "discord" and (evidence_issued_at <= 0 or evidence_expires_at <= 0 or evidence_expires_at < int(self._now())))
        if code_found and account_match and fresh:
            proof_status = "ACTIVE"
        elif code_found and not account_match:
            proof_status = "CONFLICTED"
        else:
            proof_status = "STALE"
        if proof_status not in PROOF_STATUSES:
            proof_status = fallback_status
        if risk_band not in RISK_BANDS:
            risk_band = "high" if proof_status != "ACTIVE" else "medium"
        if proof_strength not in PROOF_STRENGTHS:
            proof_strength = "WEAK"
        if not reason_code:
            reason_code = "CODE_NOT_FOUND" if not code_found else ("ACCOUNT_MISMATCH" if not account_match else ("EVIDENCE_EXPIRED" if not fresh else "CODE_FOUND_ON_CANONICAL_PROFILE"))
        return {
            "code_found": code_found, "account_match": account_match, "platform": platform,
            "username": self._normalize_username(platform, username), "canonical_platform_id": canonical_id,
            "proof_strength": proof_strength, "risk_band": risk_band,
            "confidence_bucket": max(0, min(100, confidence)), "reason_code": reason_code,
            "proof_status": proof_status, "reasoning": str(value.get("reasoning", "") or reason_code),
            "evidence_issued_at": evidence_issued_at, "evidence_expires_at": evidence_expires_at,
        }

    def _evaluate_proof(self, platform: str, username: str, code: str, target_url: str, caller: str, pending_id: str, recheck: bool) -> dict:
        username_lc = self._normalize_username(platform, username).lower()

        def leader_fn():
            try:
                response = gl.nondet.web.get(target_url)
                body = response.body
                content = body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else str(body)
            except Exception as error:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Evidence source unavailable: {error}")
            content = content[:16000] if len(content) > 16000 else content
            parsed = {}
            try:
                parsed = json.loads(content)
            except Exception:
                parsed = {}
            evidence_issued_at = 0
            evidence_expires_at = 0
            canonical_id = ""
            if platform == "github" and isinstance(parsed, dict):
                canonical_id = str(parsed.get("id", "") or "")
            elif platform == "twitter" and isinstance(parsed, dict):
                author_url = str(parsed.get("author_url", "") or "")
                author_id = str(parsed.get("author_id", "") or "")
                author_path = urlparse(author_url).path.strip("/").split("/")[0].lower() if author_url else ""
                canonical_id = f"id:{author_id}" if author_id else (f"handle:{author_path}" if author_path else "")
            elif platform == "discord" and isinstance(parsed, dict):
                canonical_id = str(parsed.get("discord_user_id", "") or parsed.get("discord_id", "") or "")
                try:
                    evidence_issued_at = int(parsed.get("issued_at", 0) or 0)
                    evidence_expires_at = int(parsed.get("expires_at", 0) or 0)
                except Exception:
                    evidence_issued_at, evidence_expires_at = 0, 0
            code_found = code in content
            account_match = False
            proof_strength = "WEAK"
            confidence = 0
            risk_band = "high"
            reason_code = "CODE_NOT_FOUND"
            if platform == "github" and isinstance(parsed, dict):
                login = str(parsed.get("login", "") or "").lower()
                account_match = login == username_lc and bool(canonical_id)
                proof_strength = "STRONG" if canonical_id else "MEDIUM"
                if code_found and account_match:
                    confidence, risk_band, reason_code = 92, "low", "CODE_FOUND_ON_CANONICAL_PROFILE"
                elif code_found:
                    confidence, reason_code = 35, "ACCOUNT_MISMATCH"
            elif platform == "twitter" and isinstance(parsed, dict):
                author_url = str(parsed.get("author_url", "") or "")
                author_path = urlparse(author_url).path.strip("/").split("/")[0].lower() if author_url else ""
                # Never infer authorship from the submitted URL.
                account_match = author_path == username_lc and bool(canonical_id)
                proof_strength = "STRONG" if str(parsed.get("author_id", "") or "") else "MEDIUM"
                if code_found and account_match:
                    confidence, risk_band, reason_code = 88, "low", "CODE_FOUND_ON_CANONICAL_TWEET"
                elif code_found:
                    confidence, reason_code = 30, "AUTHOR_MISMATCH"
            elif platform == "discord" and isinstance(parsed, dict):
                attestation_wallet = self._addr(parsed.get("wallet", ""))
                attestation_code = str(parsed.get("verification_code", "") or "")
                claimed_username = str(parsed.get("claimed_username", "") or "")
                attestation_pending_id = str(parsed.get("pending_id", "") or "")
                account_match = (
                    attestation_wallet == caller and attestation_code == code and bool(canonical_id)
                    and canonical_id == username.rsplit("#", 1)[-1].strip()
                    and (not pending_id or attestation_pending_id == pending_id)
                    and evidence_issued_at <= int(self._now()) and evidence_expires_at >= int(self._now())
                    and claimed_username.lower() == username.lower()
                )
                proof_strength = "STRONG" if canonical_id else "WEAK"
                if code_found and account_match:
                    confidence, risk_band, reason_code = 94, "low", "FRESH_OAUTH_ATTESTATION_CONFIRMED"
                elif code_found:
                    confidence, reason_code = 25, "ATTESTATION_CONFLICT"
            prompt = f"""Return strict JSON only for this SoulStamp identity evidence decision.
Fields: code_found, account_match, canonical_platform_id, proof_strength, risk_band, confidence_bucket, reason_code, reasoning.
Platform={platform}; Claimed username={username}; Recheck={recheck}
Deterministic exact code scan={code_found}; source account match={account_match}; canonical ID={canonical_id}
Evidence issued_at={evidence_issued_at}; evidence expires_at={evidence_expires_at}
Source excerpt:
---
{content}
---
Never set code_found true unless the exact code {code!r} is present. Never change the deterministic account match or canonical ID.
"""
            ai = gl.nondet.exec_prompt(prompt, response_format="json")
            verdict = self._coerce_verdict(ai, platform, username, code, content, "STALE", canonical_id, evidence_issued_at, evidence_expires_at)
            if verdict["code_found"] != code_found:
                raise gl.vm.UserError(f"{ERROR_LLM} GenLayer verdict contradicted exact code scan")
            if verdict["account_match"] != account_match:
                raise gl.vm.UserError(f"{ERROR_LLM} GenLayer verdict contradicted source account match")
            return verdict

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False
            try:
                mine = leader_fn()
            except Exception:
                return False
            for field in ("code_found", "account_match", "platform", "username", "canonical_platform_id", "reason_code", "proof_status"):
                if mine.get(field) != leader_data.get(field):
                    return False
            return abs(int(mine.get("confidence_bucket", 0)) - int(leader_data.get("confidence_bucket", 0))) <= 15

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        if not isinstance(result, dict):
            raise gl.vm.UserError(f"{ERROR_LLM} GenLayer proof verdict returned an unexpected format")
        result_canonical = str(result.get("canonical_platform_id", "") or "") if isinstance(result, dict) else ""
        result_issued_at = int(result.get("evidence_issued_at", 0) or 0) if isinstance(result, dict) else 0
        result_expires_at = int(result.get("evidence_expires_at", 0) or 0) if isinstance(result, dict) else 0
        return self._coerce_verdict(
            result, platform, username, code, "", "STALE", result_canonical,
            result_issued_at, result_expires_at,
        )

    def _resolve_challenge_consensus(self, challenge: OwnershipChallenge) -> dict:
        def leader_fn():
            challenger_content = ""
            if challenge.challenger_evidence_url:
                challenger_response = gl.nondet.web.get(challenge.challenger_evidence_url)
                challenger_body = challenger_response.body
                challenger_content = challenger_body.decode("utf-8") if isinstance(challenger_body, (bytes, bytearray)) else str(challenger_body)
                challenger_content = challenger_content[:12000]
            owner_content = ""
            if challenge.owner_rebuttal_url:
                owner_response = gl.nondet.web.get(challenge.owner_rebuttal_url)
                owner_body = owner_response.body
                owner_content = owner_body.decode("utf-8") if isinstance(owner_body, (bytes, bytearray)) else str(owner_body)
                owner_content = owner_content[:12000]
            prompt = f"""Return strict JSON only for this independent SoulStamp ownership challenge resolution.
Fields: decision, reasoning. Allowed decision: CHALLENGER_UPHOLDS, OWNER_UPHOLDS, INCONCLUSIVE.
Challenger code={challenge.challenger_code!r}; owner rebuttal code={challenge.owner_rebuttal_code!r}
Stored challenger precheck: status={challenge.challenger_evidence_status}, canonical_id={challenge.challenger_canonical_id}
Stored owner precheck: status={challenge.owner_evidence_status}, canonical_id={challenge.owner_canonical_id}
Challenger evidence:
---
{challenger_content}
---
Owner rebuttal evidence:
---
{owner_content}
---
Choose CHALLENGER_UPHOLDS only when challenger evidence is fresh, matches the canonical account, and owner rebuttal is absent or fails. Choose OWNER_UPHOLDS when challenger evidence fails or the owner has equally fresh matching evidence. Choose INCONCLUSIVE when fresh evidence conflicts.
"""
            ai = gl.nondet.exec_prompt(prompt, response_format="json")
            decision = str(ai.get("decision", "") if isinstance(ai, dict) else "").strip().upper()
            if decision not in ("CHALLENGER_UPHOLDS", "OWNER_UPHOLDS", "INCONCLUSIVE"):
                raise gl.vm.UserError(f"{ERROR_LLM} Invalid challenge resolution decision")
            if challenge.challenger_evidence_status != "ACTIVE":
                decision = "OWNER_UPHOLDS"
            elif challenge.owner_evidence_status == "ACTIVE":
                decision = "INCONCLUSIVE"
            return {"decision": decision, "reasoning": str(ai.get("reasoning", "") if isinstance(ai, dict) else "")}

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            data = leader_result.calldata
            if not isinstance(data, dict):
                return False
            try:
                challenger_content = ""
                if challenge.challenger_evidence_url:
                    challenger_response = gl.nondet.web.get(challenge.challenger_evidence_url)
                    challenger_body = challenger_response.body
                    challenger_content = challenger_body.decode("utf-8") if isinstance(challenger_body, (bytes, bytearray)) else str(challenger_body)
                    challenger_content = challenger_content[:12000]
                owner_content = ""
                if challenge.owner_rebuttal_url:
                    owner_response = gl.nondet.web.get(challenge.owner_rebuttal_url)
                    owner_body = owner_response.body
                    owner_content = owner_body.decode("utf-8") if isinstance(owner_body, (bytes, bytearray)) else str(owner_body)
                    owner_content = owner_content[:12000]
                prompt = f"""Return strict JSON only for this independent SoulStamp ownership challenge resolution.
Fields: decision, reasoning. Allowed decision: CHALLENGER_UPHOLDS, OWNER_UPHOLDS, INCONCLUSIVE.
Challenger code={challenge.challenger_code!r}; owner rebuttal code={challenge.owner_rebuttal_code!r}
Stored challenger precheck: status={challenge.challenger_evidence_status}, canonical_id={challenge.challenger_canonical_id}
Stored owner precheck: status={challenge.owner_evidence_status}, canonical_id={challenge.owner_canonical_id}
Challenger evidence:
---
{challenger_content}
---
Owner rebuttal evidence:
---
{owner_content}
---
Choose CHALLENGER_UPHOLDS only when challenger evidence is fresh, matches the canonical account, and owner rebuttal is absent or fails. Choose OWNER_UPHOLDS when challenger evidence fails or the owner has equally fresh matching evidence. Choose INCONCLUSIVE when fresh evidence conflicts.
"""
                ai = gl.nondet.exec_prompt(prompt, response_format="json")
                decision = str(ai.get("decision", "") if isinstance(ai, dict) else "").strip().upper()
                if decision not in ("CHALLENGER_UPHOLDS", "OWNER_UPHOLDS", "INCONCLUSIVE"):
                    return False
                if challenge.challenger_evidence_status != "ACTIVE":
                    decision = "OWNER_UPHOLDS"
                elif challenge.owner_evidence_status == "ACTIVE":
                    decision = "INCONCLUSIVE"
                mine = {"decision": decision}
            except Exception:
                return False
            return mine.get("decision") == data.get("decision")

        # The validator independently reruns the same evidence task through a
        # second nondeterministic execution, then compares the material outcome.
        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        if not isinstance(result, dict):
            raise gl.vm.UserError(f"{ERROR_LLM} Challenge resolution returned an unexpected format")
        return result

    # ── Verification lifecycle ────────────────────────────────────────────────

    @gl.public.write
    def request_verification(self, platform: str, username: str, profile_url: str) -> None:
        caller = self._addr(gl.message.sender_address)
        plat = self._normalize_platform(platform)
        clean_user = self._normalize_username(plat, username)
        clean_url = str(profile_url).strip()
        self._require(plat in SUPPORTED_PLATFORMS, f"Unsupported platform '{plat}'. Supported: {SUPPORTED_PLATFORMS}")
        self._require(bool(clean_user) and bool(clean_url), "username and profile_url must not be empty")
        if plat in ("github", "twitter"):
            self._require(bool(re.match(r"^[A-Za-z0-9_-]{1,64}$", clean_user)), "Username contains unsupported characters")
        existing_pending = self.pending_verifications.get(caller)
        self._require(existing_pending is None or int(existing_pending.expires_at) < int(self._now()), "A verification request is already pending")
        identity = self.identities.get(caller)
        if identity is not None:
            active_count = 0
            for acct in identity.linked_accounts:
                if acct.proof_status not in ("REVOKED", "RECOVERED"):
                    active_count += 1
                if acct.platform == plat and acct.username.lower() == clean_user.lower() and acct.proof_status not in ("REVOKED", "RECOVERED"):
                    raise gl.vm.UserError(f"{ERROR_EXPECTED} Already verified @{clean_user} on {plat}")
            self._require(active_count < MAX_ACCOUNTS_PER_ADDRESS, f"Maximum {MAX_ACCOUNTS_PER_ADDRESS} linked accounts reached")
        pkey = self._platform_key(plat, clean_user)
        existing_owner = self.platform_to_address.get(pkey)
        self._require(existing_owner is None or existing_owner == caller, "Platform account is already linked to another wallet")
        self.request_nonce = u32(int(self.request_nonce) + 1)
        pending_id = self._make_pending_id(caller, plat, clean_user, self.request_nonce)
        requested_at = self._now()
        self.pending_verifications[caller] = PendingVerification(
            platform=plat, username=clean_user, profile_url=clean_url, verification_code=self._make_code(pending_id),
            pending_id=pending_id, request_nonce=self.request_nonce, requested_at=requested_at,
            expires_at=u256(int(requested_at) + PENDING_TTL_SECONDS), wallet=caller,
        )

    @gl.public.write
    def complete_verification(self, fetch_url: str = "") -> None:
        caller = self._addr(gl.message.sender_address)
        pending = self.pending_verifications.get(caller)
        self._require(pending is not None, "No pending verification. Call request_verification() first.")
        now = self._now()
        self._require(int(now) <= int(pending.expires_at), "Verification request has expired; request fresh evidence")
        target_url = self._target_url(pending.platform, pending.username, fetch_url or pending.profile_url)
        verdict = self._evaluate_proof(pending.platform, pending.username, pending.verification_code, target_url, caller, pending.pending_id, False)
        self._require(verdict["code_found"], f"Verification code was not confirmed. Reason: {verdict['reason_code']}")
        self._require(verdict["account_match"], f"Account ownership could not be confirmed. Reason: {verdict['reason_code']}")
        self._require(verdict["proof_status"] == "ACTIVE", f"Proof is not active. Reason: {verdict['reason_code']}")
        self._require(bool(verdict["canonical_platform_id"]), "Canonical platform ID is required")
        marker = self._mark()
        identity = self.identities.get(caller)
        if identity is None:
            identity = self._create_identity(caller, marker)
        dossier = ProofDossier(
            platform=pending.platform, username=pending.username, canonical_platform_id=verdict["canonical_platform_id"],
            proof_url=target_url, verification_code=pending.verification_code, pending_id=pending.pending_id,
            proof_strength=verdict["proof_strength"], risk_band=verdict["risk_band"], confidence_bucket=u32(int(verdict["confidence_bucket"])),
            reason_code=verdict["reason_code"], proof_status="ACTIVE", verification_method="genlayer-independent-web-consensus",
            verifier_version=VERIFIER_VERSION, audit_ref=u32(0), verified_wallet=caller, created_marker=marker,
            updated_marker=marker, evidence_issued_at=u256(int(verdict.get("evidence_issued_at", 0))),
            evidence_expires_at=u256(int(now) + PROOF_VALIDITY_SECONDS),
        )
        new_account = LinkedAccount(
            platform=pending.platform, username=pending.username.lower() if pending.platform in ("github", "twitter") else pending.username,
            profile_url=pending.profile_url, verified_at=marker, confidence_score=u32(int(verdict["confidence_bucket"])),
            bot_score=u32(100 if verdict["risk_band"] == "high" else (50 if verdict["risk_band"] == "medium" else 10)),
            reasoning=verdict["reasoning"], is_active=True, proof_status="ACTIVE", proof_strength=verdict["proof_strength"],
            risk_band=verdict["risk_band"], canonical_platform_id=verdict["canonical_platform_id"], verification_code=pending.verification_code,
            pending_id=pending.pending_id, proof_url=target_url, reason_code=verdict["reason_code"], last_checked_marker=marker,
            dossier=dossier, status_before_flag="ACTIVE",
        )
        old_idx = self._find_account(identity, pending.platform, pending.username)
        if old_idx >= 0:
            old_account = identity.linked_accounts[old_idx]
            self._require(old_account.proof_status in ("REVOKED", "RECOVERED"), "An active proof already exists for this account")
            self._remove_indexes(caller, old_account)
        self._reserve_indexes(caller, new_account)
        audit_ref = self._append_audit(identity, "verification_completed", pending.platform, pending.username, "approved", int(verdict["confidence_bucket"]), int(new_account.bot_score), "ACTIVE", verdict["reason_code"], details=f"canonical_id={verdict['canonical_platform_id']};proof={pending.pending_id}", actor=caller)
        new_account.dossier.audit_ref = audit_ref
        if old_idx >= 0:
            identity.linked_accounts[old_idx] = new_account
        else:
            identity.linked_accounts.append(new_account)
        previous_count = int(identity.verification_count)
        identity.reputation_score = u32((int(identity.reputation_score) * previous_count + int(verdict["confidence_bucket"])) // (previous_count + 1))
        identity.verification_count = u32(previous_count + 1)
        identity.last_updated = marker
        self.identities[caller] = identity
        if pending.platform == "discord" and fetch_url:
            self.used_discord_attestations[fetch_url.split("/api/discord/attestations/")[-1]] = True
        del self.pending_verifications[caller]
        self.total_verifications = u32(int(self.total_verifications) + 1)

    @gl.public.write
    def reverify_platform(self, platform: str, username: str, fetch_url: str = "") -> None:
        caller = self._addr(gl.message.sender_address)
        plat = self._normalize_platform(platform)
        owner = self.platform_to_address.get(self._platform_key(plat, username))
        self._require(owner is not None, "No verified platform proof found")
        self._require(owner == caller or caller == self.admin, "Only the owner or admin can reverify this proof")
        identity = self.identities.get(owner)
        self._require(identity is not None, "Identity record not found")
        idx = self._find_account(identity, plat, username)
        self._require(idx >= 0, "Linked account not found")
        acct = identity.linked_accounts[idx]
        self._require(acct.proof_status not in ("REVOKED", "FLAGGED", "RECOVERED"), "Revoked, flagged, or recovered proofs cannot be reverified")
        self._require(plat != "discord" or bool(fetch_url), "Discord reverification requires a fresh OAuth attestation")
        target_url = self._target_url(plat, acct.username, fetch_url or acct.proof_url)
        verdict = self._evaluate_proof(plat, acct.username, acct.verification_code, target_url, owner, acct.pending_id, True)
        marker = self._mark()
        old_canonical = acct.canonical_platform_id
        new_status = verdict["proof_status"]
        if not verdict["code_found"]:
            new_status = "STALE"
        elif not verdict["account_match"]:
            new_status = "CONFLICTED"
        if new_status == "ACTIVE" and verdict["canonical_platform_id"] != old_canonical:
            self._remove_indexes(owner, acct)
            acct.canonical_platform_id = verdict["canonical_platform_id"]
            acct.dossier.canonical_platform_id = verdict["canonical_platform_id"]
            self._reserve_indexes(owner, acct)
        acct.proof_strength = verdict["proof_strength"]
        acct.risk_band = verdict["risk_band"]
        acct.confidence_score = u32(int(verdict["confidence_bucket"]))
        acct.bot_score = u32(100 if verdict["risk_band"] == "high" else (50 if verdict["risk_band"] == "medium" else 10))
        acct.reasoning = verdict["reasoning"]
        acct.dossier.proof_strength = verdict["proof_strength"]
        acct.dossier.risk_band = verdict["risk_band"]
        acct.dossier.confidence_bucket = u32(int(verdict["confidence_bucket"]))
        acct.dossier.proof_url = target_url
        acct.dossier.evidence_issued_at = u256(int(verdict.get("evidence_issued_at", 0)))
        acct.dossier.evidence_expires_at = u256(int(self._now()) + PROOF_VALIDITY_SECONDS) if new_status == "ACTIVE" else u256(0)
        self._set_account_status(acct, new_status, verdict["reason_code"], marker)
        audit_ref = self._append_audit(identity, "proof_reverified", plat, acct.username, new_status.lower(), int(verdict["confidence_bucket"]), int(acct.bot_score), new_status, verdict["reason_code"], details=f"canonical_id={acct.canonical_platform_id}", actor=caller)
        acct.dossier.audit_ref = audit_ref
        identity.linked_accounts[idx] = acct
        identity.last_updated = marker
        self.identities[owner] = identity
        if plat == "discord" and fetch_url:
            self.used_discord_attestations[fetch_url.split("/api/discord/attestations/")[-1]] = True

    @gl.public.write
    def revoke_platform(self, platform: str, username: str) -> None:
        caller = self._addr(gl.message.sender_address)
        plat = self._normalize_platform(platform)
        pkey = self._platform_key(plat, username)
        owner = self.platform_to_address.get(pkey)
        self._require(owner is not None, f"No verified link found for @{username} on {plat}")
        self._require(caller == owner or caller == self.admin, "Only the owner or admin can revoke verified links")
        identity = self.identities.get(owner)
        self._require(identity is not None, "Identity record not found")
        idx = self._find_account(identity, plat, username)
        self._require(idx >= 0, "Linked account not found")
        marker = self._mark()
        acct = identity.linked_accounts[idx]
        self._set_account_status(acct, "REVOKED", "REVOKED_BY_OWNER" if caller == owner else "REVOKED_BY_ADMIN", marker)
        acct.dossier.evidence_expires_at = u256(0)
        identity.linked_accounts[idx] = acct
        self._remove_indexes(owner, acct)
        self._append_audit(identity, "revoked", plat, username, acct.reason_code, 0, 0, "REVOKED", acct.reason_code, actor=caller)
        identity.last_updated = marker
        self.identities[owner] = identity

    @gl.public.write
    def cancel_pending_verification(self) -> None:
        caller = self._addr(gl.message.sender_address)
        self._require(self.pending_verifications.get(caller) is not None, "No pending verification to cancel")
        del self.pending_verifications[caller]

    @gl.public.write
    def request_ownership_challenge(self, platform: str, username: str) -> None:
        challenger = self._addr(gl.message.sender_address)
        plat = self._normalize_platform(platform)
        clean_user = self._normalize_username(plat, username)
        pkey = self._platform_key(plat, clean_user)
        owner = self.platform_to_address.get(pkey)
        self._require(owner is not None, "No active identity proof exists for this account")
        self._require(owner != challenger, "The current owner cannot challenge its own proof")
        identity = self.identities.get(owner)
        self._require(identity is not None and identity.identity_state == "ACTIVE", "Identity is not challengeable in its current state")
        idx = self._find_account(identity, plat, clean_user)
        self._require(idx >= 0 and identity.linked_accounts[idx].proof_status == "ACTIVE", "Only an active proof can be challenged")
        self._require(self.open_challenges_by_platform.get(pkey) is None, "An ownership challenge is already open")
        self.request_nonce = u32(int(self.request_nonce) + 1)
        challenge_id = hashlib.sha256(f"SOULSTAMP-CHALLENGE:{challenger}:{pkey}:{int(self.request_nonce)}".encode()).hexdigest()[:24].upper()
        opened_at = self._now()
        challenge = OwnershipChallenge(
            challenge_id=challenge_id, platform=plat, username=clean_user,
            canonical_platform_id=identity.linked_accounts[idx].canonical_platform_id,
            current_owner=owner, challenger_wallet=challenger,
            challenger_code=self._make_challenge_code("CHALLENGE", challenge_id),
            owner_rebuttal_code=self._make_challenge_code("REBUT", challenge_id),
            challenger_evidence_url="", owner_rebuttal_url="", owner_rebuttal_statement="",
            challenger_evidence_status="STALE", owner_evidence_status="STALE",
            challenger_canonical_id="", owner_canonical_id="", opened_at=opened_at,
            rebuttal_deadline=u256(int(opened_at) + CHALLENGE_RESPONSE_WINDOW_SECONDS), resolved_at=u256(0),
            recovery_not_before=u256(0), status="OPEN", outcome="", reason_code="AWAITING_FRESH_EVIDENCE",
            resolution_reasoning="", recovery_executed_at=u256(0),
        )
        self.challenges[challenge_id] = challenge
        self.all_challenge_ids.append(challenge_id)
        self.open_challenges_by_platform[pkey] = challenge_id
        self.latest_challenge_by_wallet[challenger] = challenge_id
        self.total_challenges = u32(int(self.total_challenges) + 1)

    @gl.public.write
    def submit_challenge_evidence(self, challenge_id: str, evidence_url: str) -> None:
        challenger = self._addr(gl.message.sender_address)
        challenge = self.challenges.get(challenge_id)
        self._require(challenge is not None, "Challenge not found")
        self._require(challenge.challenger_wallet == challenger, "Only the challenger can submit challenger evidence")
        self._require(challenge.status in ("OPEN", "AWAITING_REBUTTAL"), "Challenge is no longer accepting evidence")
        self._require(int(self._now()) <= int(challenge.rebuttal_deadline), "Challenge evidence deadline has passed")
        target_url = self._target_url(challenge.platform, challenge.username, evidence_url.strip())
        verdict = self._evaluate_proof(challenge.platform, challenge.username, challenge.challenger_code, target_url, challenger, challenge.challenge_id, True)
        challenge.challenger_evidence_url = evidence_url.strip()
        challenge.challenger_evidence_status = verdict["proof_status"]
        challenge.challenger_canonical_id = verdict["canonical_platform_id"]
        challenge.reason_code = verdict["reason_code"]
        challenge.status = "AWAITING_REBUTTAL"
        self.challenges[challenge_id] = challenge

    @gl.public.write
    def respond_to_challenge(self, challenge_id: str, rebuttal_url: str, statement: str) -> None:
        owner = self._addr(gl.message.sender_address)
        challenge = self.challenges.get(challenge_id)
        self._require(challenge is not None, "Challenge not found")
        self._require(challenge.current_owner == owner, "Only the current owner can submit a rebuttal")
        self._require(challenge.status in ("AWAITING_REBUTTAL", "OPEN"), "Challenge is no longer accepting a rebuttal")
        self._require(int(self._now()) <= int(challenge.rebuttal_deadline), "Rebuttal deadline has passed")
        self._require(bool(statement.strip()), "Rebuttal statement must not be empty")
        target_url = self._target_url(challenge.platform, challenge.username, rebuttal_url.strip())
        verdict = self._evaluate_proof(challenge.platform, challenge.username, challenge.owner_rebuttal_code, target_url, owner, challenge.challenge_id, True)
        challenge.owner_rebuttal_url = rebuttal_url.strip()
        challenge.owner_rebuttal_statement = statement.strip()[:2000]
        challenge.owner_evidence_status = verdict["proof_status"]
        challenge.owner_canonical_id = verdict["canonical_platform_id"]
        challenge.status = "RESPONDED"
        challenge.reason_code = verdict["reason_code"]
        self.challenges[challenge_id] = challenge

    @gl.public.write
    def resolve_ownership_challenge(self, challenge_id: str) -> None:
        resolver = self._addr(gl.message.sender_address)
        challenge = self.challenges.get(challenge_id)
        self._require(challenge is not None, "Challenge not found")
        self._require(challenge.status in ("AWAITING_REBUTTAL", "RESPONDED"), "Challenge is not ready for resolution")
        self._require(bool(challenge.challenger_evidence_url), "Challenger evidence has not been submitted")
        now = self._now()
        self._require(challenge.status == "RESPONDED" or int(now) >= int(challenge.rebuttal_deadline), "Wait for the rebuttal deadline or submit a rebuttal before resolving")
        resolution = self._resolve_challenge_consensus(challenge)
        decision = resolution["decision"]
        marker = self._mark()
        challenge.resolved_at = marker
        challenge.resolution_reasoning = str(resolution.get("reasoning", ""))[:2000]
        challenge.outcome = decision
        challenge.reason_code = "GENLAYER_INDEPENDENT_RESOLUTION"
        identity = self.identities.get(challenge.current_owner)
        if decision == "CHALLENGER_UPHOLDS":
            challenge.status = "RESOLVED_CHALLENGER"
            challenge.recovery_not_before = u256(int(now) + RECOVERY_DELAY_SECONDS)
            if identity is not None:
                idx = self._find_account(identity, challenge.platform, challenge.username)
                if idx >= 0:
                    acct = identity.linked_accounts[idx]
                    self._set_account_status(acct, "CONFLICTED", "OWNERSHIP_CHALLENGE_UPHELD", marker)
                    identity.linked_accounts[idx] = acct
                identity.identity_state = "RECOVERY_PENDING"
                identity.last_updated = marker
                self._append_audit(identity, "challenge_resolved", challenge.platform, challenge.username, "challenger_upheld", 0, 0, "CONFLICTED", challenge.reason_code, details=f"challenge={challenge_id};recovery_after={int(challenge.recovery_not_before)}", actor=resolver)
                self.identities[challenge.current_owner] = identity
        elif decision == "OWNER_UPHOLDS":
            challenge.status = "RESOLVED_OWNER"
            if identity is not None:
                self._append_audit(identity, "challenge_resolved", challenge.platform, challenge.username, "owner_upheld", 0, 0, "ACTIVE", challenge.reason_code, details=f"challenge={challenge_id}", actor=resolver)
                self.identities[challenge.current_owner] = identity
        else:
            challenge.status = "RESOLVED_INCONCLUSIVE"
            if identity is not None:
                self._append_audit(identity, "challenge_resolved", challenge.platform, challenge.username, "inconclusive", 0, 0, "CONFLICTED", challenge.reason_code, details=f"challenge={challenge_id}", actor=resolver)
                self.identities[challenge.current_owner] = identity
        pkey = self._platform_key(challenge.platform, challenge.username)
        if self.open_challenges_by_platform.get(pkey) == challenge_id:
            del self.open_challenges_by_platform[pkey]
        self.challenges[challenge_id] = challenge

    def _clone_account(self, acct: LinkedAccount, new_wallet: str, marker: u256) -> LinkedAccount:
        dossier = ProofDossier(
            platform=acct.dossier.platform, username=acct.dossier.username, canonical_platform_id=acct.dossier.canonical_platform_id,
            proof_url=acct.dossier.proof_url, verification_code=acct.dossier.verification_code, pending_id=acct.dossier.pending_id,
            proof_strength=acct.dossier.proof_strength, risk_band=acct.dossier.risk_band, confidence_bucket=u32(int(acct.dossier.confidence_bucket)),
            reason_code=acct.dossier.reason_code, proof_status=acct.dossier.proof_status, verification_method=acct.dossier.verification_method,
            verifier_version=acct.dossier.verifier_version, audit_ref=u32(int(acct.dossier.audit_ref)), verified_wallet=new_wallet,
            created_marker=acct.dossier.created_marker, updated_marker=marker, evidence_issued_at=acct.dossier.evidence_issued_at,
            evidence_expires_at=acct.dossier.evidence_expires_at,
        )
        return LinkedAccount(
            platform=acct.platform, username=acct.username, profile_url=acct.profile_url, verified_at=acct.verified_at,
            confidence_score=acct.confidence_score, bot_score=acct.bot_score, reasoning=acct.reasoning,
            is_active=acct.is_active, proof_status=acct.proof_status, proof_strength=acct.proof_strength, risk_band=acct.risk_band,
            canonical_platform_id=acct.canonical_platform_id, verification_code=acct.verification_code, pending_id=acct.pending_id,
            proof_url=acct.proof_url, reason_code=acct.reason_code, last_checked_marker=marker, dossier=dossier,
            status_before_flag=acct.status_before_flag,
        )

    def _clone_audit(self, entry: AuditEntry) -> AuditEntry:
        return AuditEntry(
            action=entry.action, platform=entry.platform, username=entry.username, result=entry.result,
            confidence=entry.confidence, bot_score=entry.bot_score, timestamp=entry.timestamp,
            proof_status=entry.proof_status, reason_code=entry.reason_code, actor=entry.actor,
            details=entry.details, previous_hash=entry.previous_hash, event_hash=entry.event_hash,
        )

    @gl.public.write
    def execute_wallet_recovery(self, challenge_id: str) -> None:
        new_wallet = self._addr(gl.message.sender_address)
        challenge = self.challenges.get(challenge_id)
        self._require(challenge is not None, "Challenge not found")
        self._require(challenge.status == "RESOLVED_CHALLENGER" and challenge.outcome == "CHALLENGER_UPHOLDS", "Challenge has not authorized recovery")
        self._require(challenge.challenger_wallet == new_wallet, "Only the challenge-winning wallet can execute recovery")
        self._require(int(self._now()) >= int(challenge.recovery_not_before), "Recovery safety delay has not elapsed")
        self._require(self.identities.get(new_wallet) is None, "Recovery destination wallet already has an identity")
        old_identity = self.identities.get(challenge.current_owner)
        self._require(old_identity is not None and old_identity.identity_state == "RECOVERY_PENDING", "Source identity is not pending recovery")
        marker = self._mark()
        new_identity = IdentityRecord(
            owner=new_wallet, linked_accounts=[], reputation_score=old_identity.reputation_score, is_flagged=False,
            flag_reason="", created_at=old_identity.created_at, last_updated=marker, verification_count=old_identity.verification_count,
            audit_log=[], principal_id=old_identity.principal_id, identity_state="ACTIVE", recovery_target="",
        )
        for old_entry in old_identity.audit_log:
            new_identity.audit_log.append(self._clone_audit(old_entry))
        for i in range(len(old_identity.linked_accounts)):
            acct = old_identity.linked_accounts[i]
            if acct.proof_status == "CONFLICTED" and acct.platform == challenge.platform and acct.username.lower() == challenge.username.lower():
                acct.proof_status = "ACTIVE"
                acct.is_active = True
                acct.reason_code = "RECOVERED_BY_INDEPENDENT_CONSENSUS"
                acct.dossier.proof_status = "ACTIVE"
                acct.dossier.reason_code = acct.reason_code
                acct.dossier.verified_wallet = new_wallet
                acct.dossier.updated_marker = marker
                # The winning challenge supplied fresh evidence. Start a new
                # proof-validity window from the finalized recovery event.
                acct.dossier.evidence_expires_at = u256(int(self._now()) + PROOF_VALIDITY_SECONDS)
            elif acct.proof_status == "ACTIVE":
                acct.dossier.verified_wallet = new_wallet
            self._remove_indexes(challenge.current_owner, acct)
            copied = self._clone_account(acct, new_wallet, marker)
            new_identity.linked_accounts.append(copied)
            if copied.proof_status == "ACTIVE":
                self._reserve_indexes(new_wallet, copied)
            self._set_account_status(acct, "RECOVERED", "WALLET_RECOVERED", marker)
            old_identity.linked_accounts[i] = acct
        old_identity.identity_state = "RECOVERED"
        old_identity.recovery_target = new_wallet
        old_identity.last_updated = marker
        self._append_audit(old_identity, "wallet_recovery_executed", challenge.platform, challenge.username, "recovered", 0, 0, "RECOVERED", "WALLET_RECOVERED", details=f"challenge={challenge_id};new_wallet={new_wallet}", actor=new_wallet)
        self._append_audit(new_identity, "wallet_recovery_executed", challenge.platform, challenge.username, "recovered", 0, 0, "ACTIVE", "WALLET_RECOVERED", details=f"challenge={challenge_id};old_wallet={challenge.current_owner}", actor=new_wallet)
        self.identities[challenge.current_owner] = old_identity
        self.identities[new_wallet] = new_identity
        self.all_addresses.append(new_wallet)
        self.wallet_to_principal[new_wallet] = old_identity.principal_id
        self.principal_to_wallet[old_identity.principal_id] = new_wallet
        challenge.status = "EXECUTED"
        challenge.recovery_executed_at = marker
        challenge.reason_code = "WALLET_RECOVERED_BY_CONSENSUS"
        self.challenges[challenge_id] = challenge
        self.total_recoveries = u32(int(self.total_recoveries) + 1)

    # ── Admin and migration ───────────────────────────────────────────────────

    @gl.public.write
    def flag_identity(self, target: str, reason: str) -> None:
        caller = self._addr(gl.message.sender_address)
        self._require(caller == self.admin, "Only the admin can flag identities")
        target = self._addr(target)
        identity = self.identities.get(target)
        self._require(identity is not None, "Identity not found")
        marker = self._mark()
        identity.is_flagged = True
        identity.identity_state = "FLAGGED"
        identity.flag_reason = reason.strip()[:1000]
        for i in range(len(identity.linked_accounts)):
            acct = identity.linked_accounts[i]
            if acct.proof_status not in ("REVOKED", "RECOVERED"):
                acct.status_before_flag = acct.proof_status
                self._set_account_status(acct, "FLAGGED", "ADMIN_FLAGGED", marker)
                identity.linked_accounts[i] = acct
        self._append_audit(identity, "admin_flagged", "", "", reason, 0, 0, "FLAGGED", "ADMIN_FLAGGED", actor=caller)
        identity.last_updated = marker
        self.identities[target] = identity

    @gl.public.write
    def unflag_identity(self, target: str) -> None:
        caller = self._addr(gl.message.sender_address)
        self._require(caller == self.admin, "Only the admin can unflag identities")
        target = self._addr(target)
        identity = self.identities.get(target)
        self._require(identity is not None, "Identity not found")
        marker = self._mark()
        identity.is_flagged = False
        identity.identity_state = "ACTIVE"
        identity.flag_reason = ""
        for i in range(len(identity.linked_accounts)):
            acct = identity.linked_accounts[i]
            if acct.proof_status == "FLAGGED":
                restore = acct.status_before_flag if acct.status_before_flag in PROOF_STATUSES else "STALE"
                self._set_account_status(acct, restore, "ADMIN_UNFLAGGED", marker)
                identity.linked_accounts[i] = acct
        self._append_audit(identity, "admin_unflagged", "", "", "cleared_by_admin", 0, 0, "ACTIVE", "ADMIN_UNFLAGGED", actor=caller)
        identity.last_updated = marker
        self.identities[target] = identity

    @gl.public.write
    def set_discord_attestation_base_url(self, base_url: str) -> None:
        caller = self._addr(gl.message.sender_address)
        self._require(caller == self.admin, "Only the admin can configure Discord attestations")
        clean = str(base_url).strip().rstrip("/")
        self._require(clean.startswith("https://") or clean.startswith("http://"), "Discord attestation backend must be an http(s) URL")
        self.discord_attestation_base_url = clean

    @gl.public.write
    def transfer_admin(self, new_admin: str) -> None:
        self._require(self._addr(gl.message.sender_address) == self.admin, "Only the admin can transfer admin role")
        self._require(self._valid_address(new_admin), "New admin must be a valid address")
        self.admin = self._addr(new_admin)

    @gl.public.write
    def migrate_legacy_identity(self, legacy_owner: str) -> None:
        """Explicit admin migration that reads the prior contract on-chain."""
        caller = self._addr(gl.message.sender_address)
        self._require(caller == self.admin, "Only the admin can migrate legacy identities")
        self._require(bool(self.legacy_contract_address), "Legacy contract address is not configured")
        owner = self._addr(legacy_owner)
        self._require(self.identities.get(owner) is None, "Identity is already migrated")
        legacy = gl.get_contract_at(Address(self.legacy_contract_address))
        legacy_identity = legacy.view().get_identity(owner)
        self._require(isinstance(legacy_identity, dict) and bool(legacy_identity.get("found")), "Legacy identity was not found")
        marker = self._mark()
        identity = self._create_identity(owner, marker)
        identity.reputation_score = u32(int(legacy_identity.get("reputation_score", 0)))
        identity.verification_count = u32(int(legacy_identity.get("verification_count", 0)))
        for legacy_acct in legacy_identity.get("linked_accounts", []):
            platform = self._normalize_platform(str(legacy_acct.get("platform", "")))
            username = self._normalize_username(platform, str(legacy_acct.get("username", "")))
            canonical_id = str(legacy_acct.get("canonical_platform_id", "") or "")
            if not platform or not username or not canonical_id:
                continue
            status = str(legacy_acct.get("proof_status", "STALE") or "STALE")
            if status not in PROOF_STATUSES:
                status = "STALE"
            proof_url = str(legacy_acct.get("proof_url", "") or legacy_acct.get("profile_url", ""))
            code = str(legacy_acct.get("verification_code", "") or "LEGACY")
            pending_id = str(legacy_acct.get("pending_id", "") or "LEGACY")
            dossier = self._empty_dossier(platform, username, proof_url, code, pending_id, owner, marker)
            dossier.canonical_platform_id = canonical_id
            dossier.proof_status = status
            dossier.proof_strength = str(legacy_acct.get("proof_strength", "WEAK") or "WEAK")
            dossier.risk_band = str(legacy_acct.get("risk_band", "medium") or "medium")
            dossier.confidence_bucket = u32(int(legacy_acct.get("confidence_score", 0)))
            dossier.reason_code = "MIGRATED_FROM_SOULSTAMP_V2"
            acct = LinkedAccount(
                platform=platform, username=username, profile_url=str(legacy_acct.get("profile_url", "")), verified_at=u256(int(legacy_acct.get("verified_at", 0))),
                confidence_score=u32(int(legacy_acct.get("confidence_score", 0))), bot_score=u32(int(legacy_acct.get("bot_score", 0))),
                reasoning=str(legacy_acct.get("reasoning", "")), is_active=status == "ACTIVE", proof_status=status,
                proof_strength=dossier.proof_strength, risk_band=dossier.risk_band, canonical_platform_id=canonical_id,
                verification_code=code, pending_id=pending_id, proof_url=proof_url, reason_code="MIGRATED_FROM_SOULSTAMP_V2",
                last_checked_marker=marker, dossier=dossier, status_before_flag=status,
            )
            if status == "ACTIVE":
                self._reserve_indexes(owner, acct)
            identity.linked_accounts.append(acct)
        self._append_audit(identity, "legacy_identity_migrated", "", "", "migrated", 0, 0, "ACTIVE", "MIGRATED_FROM_SOULSTAMP_V2", details=f"source={self.legacy_contract_address}", actor=caller)
        identity.last_updated = marker
        self.identities[owner] = identity

    # ── Public and consumer interfaces ────────────────────────────────────────

    def _eligibility(self, address: str) -> dict:
        wallet = self._addr(address)
        identity = self.identities.get(wallet)
        now = self._now()
        if identity is None:
            return {"eligible": False, "reason": "NO_IDENTITY", "owner": wallet, "principal_id": "", "active_proofs": u32(0), "checked_at": int(now)}
        if identity.identity_state != "ACTIVE" or identity.is_flagged:
            return {"eligible": False, "reason": identity.identity_state, "owner": identity.owner, "principal_id": identity.principal_id, "active_proofs": u32(0), "checked_at": int(now)}
        active = 0
        for acct in identity.linked_accounts:
            if self._is_active_account(acct, now):
                active += 1
        if active == 0:
            return {"eligible": False, "reason": "NO_FRESH_ACTIVE_PROOF", "owner": identity.owner, "principal_id": identity.principal_id, "active_proofs": u32(0), "checked_at": int(now)}
        return {"eligible": True, "reason": "ACTIVE_FRESH_PROOF", "owner": identity.owner, "principal_id": identity.principal_id, "active_proofs": u32(active), "checked_at": int(now)}

    def _challenge_dict(self, challenge: OwnershipChallenge) -> dict:
        return {
            "challenge_id": challenge.challenge_id, "platform": challenge.platform, "username": challenge.username,
            "canonical_platform_id": challenge.canonical_platform_id, "current_owner": challenge.current_owner,
            "challenger_wallet": challenge.challenger_wallet, "challenger_code": challenge.challenger_code,
            "owner_rebuttal_code": challenge.owner_rebuttal_code, "challenger_evidence_url": challenge.challenger_evidence_url,
            "owner_rebuttal_url": challenge.owner_rebuttal_url, "owner_rebuttal_statement": challenge.owner_rebuttal_statement,
            "challenger_evidence_status": challenge.challenger_evidence_status, "owner_evidence_status": challenge.owner_evidence_status,
            "challenger_canonical_id": challenge.challenger_canonical_id, "owner_canonical_id": challenge.owner_canonical_id,
            "opened_at": int(challenge.opened_at), "rebuttal_deadline": int(challenge.rebuttal_deadline),
            "resolved_at": int(challenge.resolved_at), "recovery_not_before": int(challenge.recovery_not_before),
            "status": challenge.status, "outcome": challenge.outcome, "reason_code": challenge.reason_code,
            "resolution_reasoning": challenge.resolution_reasoning, "recovery_executed_at": int(challenge.recovery_executed_at),
        }

    @gl.public.view
    def get_identity(self, address: str) -> dict:
        identity = self.identities.get(self._addr(address))
        if identity is None:
            return {"found": False}
        accounts = []
        for acct in identity.linked_accounts:
            accounts.append({
                "platform": acct.platform, "username": acct.username, "profile_url": acct.profile_url,
                "verified_at": int(acct.verified_at), "confidence_score": int(acct.confidence_score), "bot_score": int(acct.bot_score),
                "reasoning": acct.reasoning, "is_active": acct.is_active, "proof_status": acct.proof_status,
                "proof_strength": acct.proof_strength, "risk_band": acct.risk_band, "canonical_platform_id": acct.canonical_platform_id,
                "verification_code": acct.verification_code, "pending_id": acct.pending_id, "proof_url": acct.proof_url,
                "reason_code": acct.reason_code, "last_checked_marker": int(acct.last_checked_marker), "status_before_flag": acct.status_before_flag,
                "dossier": {
                    "platform": acct.dossier.platform, "username": acct.dossier.username, "canonical_platform_id": acct.dossier.canonical_platform_id,
                    "proof_url": acct.dossier.proof_url, "verification_code": acct.dossier.verification_code, "pending_id": acct.dossier.pending_id,
                    "proof_strength": acct.dossier.proof_strength, "risk_band": acct.dossier.risk_band, "confidence_bucket": int(acct.dossier.confidence_bucket),
                    "reason_code": acct.dossier.reason_code, "proof_status": acct.dossier.proof_status, "verification_method": acct.dossier.verification_method,
                    "verifier_version": acct.dossier.verifier_version, "audit_ref": int(acct.dossier.audit_ref), "verified_wallet": acct.dossier.verified_wallet,
                    "created_marker": int(acct.dossier.created_marker), "updated_marker": int(acct.dossier.updated_marker),
                    "evidence_issued_at": int(acct.dossier.evidence_issued_at), "evidence_expires_at": int(acct.dossier.evidence_expires_at),
                },
            })
        eligibility = self._eligibility(identity.owner)
        return {
            "found": True, "owner": identity.owner, "linked_accounts": accounts, "reputation_score": int(identity.reputation_score),
            "is_flagged": identity.is_flagged, "flag_reason": identity.flag_reason, "created_at": int(identity.created_at),
            "last_updated": int(identity.last_updated), "verification_count": int(identity.verification_count), "principal_id": identity.principal_id,
            "identity_state": identity.identity_state, "recovery_target": identity.recovery_target, "eligible": bool(eligibility["eligible"]),
            "eligibility_reason": eligibility["reason"],
        }

    @gl.public.view
    def get_pending_verification(self, address: str) -> dict:
        pending = self.pending_verifications.get(self._addr(address))
        if pending is None:
            return {"found": False}
        return {
            "found": True, "platform": pending.platform, "username": pending.username, "profile_url": pending.profile_url,
            "verification_code": pending.verification_code, "pending_id": pending.pending_id, "request_nonce": int(pending.request_nonce),
            "requested_at": int(pending.requested_at), "expires_at": int(pending.expires_at),
        }

    @gl.public.view
    def get_challenge(self, challenge_id: str) -> dict:
        challenge = self.challenges.get(challenge_id)
        if challenge is None:
            return {"found": False}
        result = self._challenge_dict(challenge)
        result["found"] = True
        return result

    @gl.public.view
    def get_challenges(self, address: str, offset: u32 = u32(0), limit: u32 = u32(50)) -> list:
        wallet = self._addr(address)
        found = []
        for i in range(int(offset), len(self.all_challenge_ids)):
            challenge = self.challenges.get(self.all_challenge_ids[i])
            if challenge is not None and (challenge.challenger_wallet == wallet or challenge.current_owner == wallet):
                found.append(self._challenge_dict(challenge))
                if len(found) >= min(int(limit), 100):
                    break
        return found

    @gl.public.view
    def get_all_challenges(self, offset: u32 = u32(0), limit: u32 = u32(50)) -> list:
        start = int(offset)
        end = min(start + min(int(limit), 100), len(self.all_challenge_ids))
        return [self._challenge_dict(self.challenges[self.all_challenge_ids[i]]) for i in range(start, end)]

    @gl.public.view
    def lookup_by_platform(self, platform: str, username: str) -> dict:
        plat = self._normalize_platform(platform)
        owner = self.platform_to_address.get(self._platform_key(plat, username))
        if owner is None:
            return {"found": False}
        identity = self.identities.get(owner)
        if identity is None:
            return {"found": False}
        idx = self._find_account(identity, plat, username)
        if idx < 0:
            return {"found": False}
        acct = identity.linked_accounts[idx]
        eligibility = self._eligibility(owner)
        return {
            "found": True, "owner_address": owner, "reputation_score": int(identity.reputation_score), "is_flagged": identity.is_flagged,
            "verification_count": int(identity.verification_count), "proof_status": acct.proof_status, "canonical_platform_id": acct.canonical_platform_id,
            "identity_state": identity.identity_state, "eligible": bool(eligibility["eligible"]), "eligibility_reason": eligibility["reason"],
        }

    @gl.public.view
    def is_platform_taken(self, platform: str, username: str) -> bool:
        return self.platform_to_address.get(self._platform_key(self._normalize_platform(platform), username)) is not None

    @gl.public.view
    def get_audit_log(self, address: str) -> list:
        identity = self.identities.get(self._addr(address))
        if identity is None:
            return []
        return [{
            "action": e.action, "platform": e.platform, "username": e.username, "result": e.result, "confidence": int(e.confidence),
            "bot_score": int(e.bot_score), "timestamp": int(e.timestamp), "proof_status": e.proof_status, "reason_code": e.reason_code,
            "actor": e.actor, "details": e.details, "previous_hash": e.previous_hash, "event_hash": e.event_hash,
        } for e in identity.audit_log]

    @gl.public.view
    def consumer_eligibility(self, address: str) -> dict:
        return self._eligibility(address)

    @gl.public.view
    def is_eligible(self, address: str) -> bool:
        return bool(self._eligibility(address)["eligible"])

    @gl.public.view
    def get_all_addresses(self, offset: u32, limit: u32) -> list:
        start = int(offset)
        end = min(start + int(limit), len(self.all_addresses))
        return [self.all_addresses[i] for i in range(start, end)]

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "total_verifications": int(self.total_verifications), "total_identities": int(self.total_identities),
            "total_challenges": int(self.total_challenges), "total_recoveries": int(self.total_recoveries), "admin": self.admin,
            "supported_platforms": SUPPORTED_PLATFORMS, "proof_statuses": PROOF_STATUSES, "challenge_statuses": CHALLENGE_STATUSES,
            "verifier_version": VERIFIER_VERSION, "discord_attestation_base_url": self.discord_attestation_base_url,
            "legacy_contract_address": self.legacy_contract_address,
        }
