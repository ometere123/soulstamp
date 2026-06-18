# v0.2.18
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import hashlib
import json
from urllib.parse import quote

SUPPORTED_PLATFORMS = ["github", "twitter", "discord"]
PROOF_STATUSES = ["ACTIVE", "STALE", "REVOKED", "CONFLICTED", "FLAGGED"]
PROOF_STRENGTHS = ["STRONG", "MEDIUM", "WEAK"]
RISK_BANDS = ["low", "medium", "high"]
CONFIDENCE_THRESHOLD = 65
BOT_FLAG_THRESHOLD = 75
MAX_ACCOUNTS_PER_ADDRESS = 10
VERIFIER_VERSION = "soulstamp-v2.0"


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


@allow_storage
@dataclass
class PendingVerification:
    platform: str
    username: str
    profile_url: str
    verification_code: str
    pending_id: str
    request_nonce: u32


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


class SoulStamp(gl.Contract):
    """
    SoulStamp v2: GenLayer-powered identity proof health protocol.

    The contract verifies public identity proofs once, then lets GenLayer
    re-check live sources over time and classify each proof as ACTIVE, STALE,
    CONFLICTED, REVOKED, or FLAGGED.
    """

    identities: TreeMap[str, IdentityRecord]
    pending_verifications: TreeMap[str, PendingVerification]
    platform_to_address: TreeMap[str, str]
    used_discord_attestations: TreeMap[str, bool]
    all_addresses: DynArray[str]
    admin: str
    total_verifications: u32
    total_identities: u32
    request_nonce: u32
    event_marker: u256
    discord_attestation_base_url: str

    def __init__(self, admin_address: str = "") -> None:
        admin = admin_address or str(gl.message.sender_address)
        if not admin or not str(admin).lower().startswith("0x"):
            raise gl.vm.UserError("admin_address must be a valid 0x-prefixed address")
        self.admin = self._addr(admin)
        self.total_verifications = u32(0)
        self.total_identities = u32(0)
        self.request_nonce = u32(0)
        self.event_marker = u256(0)
        self.discord_attestation_base_url = ""

    def _addr(self, address) -> str:
        return str(address).lower()

    def _mark(self) -> u256:
        self.event_marker = u256(int(self.event_marker) + 1)
        return self.event_marker

    def _normalize_platform(self, platform: str) -> str:
        p = platform.lower().strip()
        if p == "x":
            return "twitter"
        if p in ("discordapp", "discord_app"):
            return "discord"
        return p

    def _platform_key(self, platform: str, username: str) -> str:
        return f"{platform}:{username.lower().strip()}"

    def _make_pending_id(self, caller: str, platform: str, username: str, nonce: u32) -> str:
        raw = f"SOULSTAMP-V2:{caller}:{platform}:{username.lower().strip()}:{int(nonce)}"
        return hashlib.sha256(raw.encode()).hexdigest()[:24].upper()

    def _make_code(self, pending_id: str) -> str:
        return f"SOULSTAMP-VERIFY-{pending_id[:12]}"

    def _empty_dossier(
        self,
        platform: str,
        username: str,
        proof_url: str,
        code: str,
        pending_id: str,
        wallet: str,
        marker: u256,
    ) -> ProofDossier:
        return ProofDossier(
            platform=platform,
            username=username,
            canonical_platform_id="",
            proof_url=proof_url,
            verification_code=code,
            pending_id=pending_id,
            proof_strength="WEAK",
            risk_band="medium",
            confidence_bucket=u32(0),
            reason_code="PENDING",
            proof_status="STALE",
            verification_method="genlayer-web-consensus",
            verifier_version=VERIFIER_VERSION,
            audit_ref=u32(0),
            verified_wallet=wallet,
            created_marker=marker,
            updated_marker=marker,
        )

    def _target_url(self, platform: str, username: str, fetch_url: str) -> str:
        username_lc = username.lower().strip()
        if platform == "github":
            if fetch_url:
                lowered = fetch_url.lower()
                allowed = (
                    f"https://github.com/{username_lc}",
                    f"https://api.github.com/users/{username_lc}",
                )
                if not any(lowered.startswith(x) for x in allowed):
                    raise gl.vm.UserError("GitHub verification must use the claimed GitHub profile or API source")
            return f"https://api.github.com/users/{username}"

        if platform == "twitter":
            if not fetch_url:
                raise gl.vm.UserError("Twitter verification requires a public tweet URL")
            lowered = fetch_url.lower()
            patterns = (f"https://x.com/{username_lc}/status/", f"https://twitter.com/{username_lc}/status/")
            if not any(lowered.startswith(p) for p in patterns):
                raise gl.vm.UserError("Twitter proof URL must be a status URL owned by the claimed handle")
            tweet_id = fetch_url.split("/status/", 1)[1].split("?", 1)[0].split("/", 1)[0]
            tweet_url = f"https://twitter.com/i/status/{tweet_id}"
            return f"https://publish.twitter.com/oembed?url={quote(tweet_url, safe='')}&dnt=true&omit_script=true"

        if platform == "discord":
            if not fetch_url:
                raise gl.vm.UserError("Discord verification requires an attestation URL")
            base = self.discord_attestation_base_url.rstrip("/")
            if not base:
                raise gl.vm.UserError("Discord attestation backend is not configured")
            prefix = f"{base}/api/discord/attestations/"
            if not fetch_url.startswith(prefix):
                raise gl.vm.UserError("Discord attestation URL is not from the configured backend")
            token = fetch_url.split("/")[-1]
            if self.used_discord_attestations.get(token) is not None:
                raise gl.vm.UserError("Discord attestation has already been used")
            return fetch_url

        raise gl.vm.UserError(f"Unsupported platform '{platform}'")

    def _coerce_verdict(
        self,
        value,
        platform: str,
        username: str,
        code: str,
        content: str,
        fallback_status: str,
    ) -> dict:
        if not isinstance(value, dict):
            raise gl.vm.UserError("GenLayer proof verdict was not structured JSON")

        code_found = bool(value.get("code_found", code in content))
        account_match = bool(value.get("account_match", False))
        reason_code = str(value.get("reason_code", "") or "").strip().upper()
        proof_status = str(value.get("proof_status", fallback_status) or fallback_status).strip().upper()
        risk_band = str(value.get("risk_band", "medium") or "medium").strip().lower()
        proof_strength = str(value.get("proof_strength", "WEAK") or "WEAK").strip().upper()

        if proof_status not in PROOF_STATUSES:
            raise gl.vm.UserError("GenLayer proof verdict used an invalid proof_status")
        if risk_band not in RISK_BANDS:
            raise gl.vm.UserError("GenLayer proof verdict used an invalid risk_band")
        if proof_strength not in PROOF_STRENGTHS:
            raise gl.vm.UserError("GenLayer proof verdict used an invalid proof_strength")

        if not reason_code:
            if code_found and account_match:
                reason_code = "CODE_FOUND_ON_CANONICAL_PROFILE"
            elif code_found:
                reason_code = "CODE_FOUND_ACCOUNT_UNCONFIRMED"
            else:
                reason_code = "CODE_NOT_FOUND"

        try:
            confidence = int(value.get("confidence_bucket", 0))
        except Exception:
            confidence = 0

        return {
            "code_found": code_found,
            "account_match": account_match,
            "platform": platform,
            "username": username,
            "canonical_platform_id": str(value.get("canonical_platform_id", "") or ""),
            "proof_strength": proof_strength,
            "risk_band": risk_band,
            "confidence_bucket": max(0, min(100, confidence)),
            "reason_code": reason_code,
            "proof_status": proof_status,
            "reasoning": str(value.get("reasoning", "") or reason_code),
        }

    def _evaluate_proof(
        self,
        platform: str,
        username: str,
        code: str,
        target_url: str,
        caller: str,
        pending_id: str,
        recheck: bool,
    ) -> dict:
        username_lc = username.lower().strip()

        def leader_fn():
            try:
                response = gl.nondet.web.get(target_url)
                body = response.body
                content = body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else str(body)
            except Exception as e:
                content = ""
                fetch_error = str(e)
            else:
                fetch_error = ""

            content = content[:12000] if len(content) > 12000 else content
            if not content:
                return {
                    "code_found": False,
                    "account_match": False,
                    "platform": platform,
                    "username": username,
                    "canonical_platform_id": "",
                    "proof_strength": "WEAK",
                    "risk_band": "medium",
                    "confidence_bucket": 0,
                    "reason_code": "SOURCE_INACCESSIBLE",
                    "proof_status": "STALE" if recheck else "STALE",
                    "reasoning": f"Source inaccessible: {fetch_error}" if fetch_error else "Source inaccessible",
                }

            code_found = code in content
            parsed = {}
            try:
                parsed = json.loads(content)
            except Exception:
                parsed = {}

            account_match = False
            canonical_id = ""
            proof_strength = "WEAK"
            confidence = 0
            risk_band = "medium"
            reason_code = "CODE_NOT_FOUND"
            proof_status = "STALE" if recheck else "STALE"

            if platform == "github" and isinstance(parsed, dict):
                login = str(parsed.get("login", "") or "").lower()
                canonical_id = str(parsed.get("id", "") or "")
                account_match = login == username_lc
                proof_strength = "STRONG" if canonical_id else "MEDIUM"
                if code_found and account_match:
                    confidence = 92 if canonical_id else 82
                    risk_band = "low"
                    reason_code = "CODE_FOUND_ON_CANONICAL_PROFILE"
                    proof_status = "ACTIVE"
                elif code_found:
                    confidence = 45
                    risk_band = "high"
                    reason_code = "CODE_FOUND_ACCOUNT_MISMATCH"
                    proof_status = "CONFLICTED"

            elif platform == "twitter":
                html = str(parsed.get("html", "")) if isinstance(parsed, dict) else content
                author_url = str(parsed.get("author_url", "") or "") if isinstance(parsed, dict) else ""
                account_match = username_lc in author_url.lower() or f"/{username_lc}/status/" in target_url.lower()
                proof_strength = "MEDIUM"
                if code_found and account_match:
                    confidence = 82
                    risk_band = "low"
                    reason_code = "CODE_FOUND_ON_CANONICAL_TWEET"
                    proof_status = "ACTIVE"
                elif code in html:
                    confidence = 45
                    risk_band = "high"
                    reason_code = "CODE_FOUND_ACCOUNT_MISMATCH"
                    proof_status = "CONFLICTED"

            elif platform == "discord" and isinstance(parsed, dict):
                canonical_id = str(parsed.get("discord_user_id", "") or parsed.get("discord_id", "") or "")
                attestation_wallet = self._addr(parsed.get("wallet", ""))
                attestation_code = str(parsed.get("verification_code", "") or "")
                claimed_username = str(parsed.get("claimed_username", "") or "")
                attestation_pending_id = str(parsed.get("pending_id", "") or "")
                account_match = (
                    attestation_wallet == caller
                    and attestation_code == code
                    and canonical_id
                    and (canonical_id == username.rsplit("#", 1)[-1].strip() or claimed_username == username)
                    and (not pending_id or attestation_pending_id == pending_id)
                )
                proof_strength = "STRONG" if canonical_id else "WEAK"
                if code_found and account_match:
                    confidence = 90
                    risk_band = "low"
                    reason_code = "OAUTH_ATTESTATION_CONFIRMED"
                    proof_status = "ACTIVE"
                elif code_found:
                    confidence = 35
                    risk_band = "high"
                    reason_code = "OAUTH_ATTESTATION_CONFLICT"
                    proof_status = "CONFLICTED"

            prompt = f"""Return strict JSON only for this SoulStamp v2 identity proof verdict.
Fields: code_found, account_match, platform, username, canonical_platform_id,
proof_strength, risk_band, confidence_bucket, reason_code, proof_status, reasoning.

Allowed proof_status: ACTIVE, STALE, CONFLICTED, REVOKED, FLAGGED.
Allowed proof_strength: STRONG, MEDIUM, WEAK.
Allowed risk_band: low, medium, high.

Deterministic precheck:
code_found={code_found}
account_match={account_match}
platform={platform}
username={username}
canonical_platform_id={canonical_id}
proof_strength={proof_strength}
risk_band={risk_band}
confidence_bucket={confidence}
reason_code={reason_code}
proof_status={proof_status}

Source excerpt:
---
{content}
---

Critical rule: do not set code_found true unless the exact code "{code}" is present.
Critical rule: do not set proof_status ACTIVE unless code_found and account_match are true.
"""
            ai = gl.nondet.exec_prompt(prompt, response_format="json")
            verdict = self._coerce_verdict(ai, platform, username, code, content, proof_status)
            if verdict["code_found"] != code_found:
                raise gl.vm.UserError("GenLayer verdict contradicted exact code scan")
            if verdict["account_match"] != account_match:
                raise gl.vm.UserError("GenLayer verdict contradicted account match scan")
            return verdict

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False
            mine = leader_fn()
            if not isinstance(mine, dict):
                return False
            for field in ("code_found", "account_match", "platform", "username", "reason_code", "proof_status"):
                if mine.get(field) != leader_data.get(field):
                    return False
            if mine.get("risk_band") not in RISK_BANDS or leader_data.get("risk_band") not in RISK_BANDS:
                return False
            diff = abs(int(mine.get("confidence_bucket", 0)) - int(leader_data.get("confidence_bucket", 0)))
            return diff <= 15

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        if not isinstance(result, dict):
            raise gl.vm.UserError("GenLayer proof verdict returned an unexpected format")
        return self._coerce_verdict(result, platform, username, code, "", "STALE")

    def _find_account(self, identity: IdentityRecord, platform: str, username: str) -> int:
        idx = 0
        for acct in identity.linked_accounts:
            if acct.platform == platform and acct.username.lower() == username.lower():
                return idx
            idx += 1
        return -1

    def _append_audit(
        self,
        identity: IdentityRecord,
        action: str,
        platform: str,
        username: str,
        result: str,
        confidence: int,
        bot_score: int,
        proof_status: str,
        reason_code: str,
    ) -> u32:
        marker = self._mark()
        identity.audit_log.append(AuditEntry(
            action=action,
            platform=platform,
            username=username,
            result=result,
            confidence=u32(max(0, min(100, confidence))),
            bot_score=u32(max(0, min(100, bot_score))),
            timestamp=marker,
            proof_status=proof_status,
            reason_code=reason_code,
        ))
        return u32(len(identity.audit_log))

    @gl.public.write
    def request_verification(self, platform: str, username: str, profile_url: str) -> None:
        caller = self._addr(gl.message.sender_address)
        plat = self._normalize_platform(platform)
        clean_user = username.strip()
        clean_url = profile_url.strip()

        if plat not in SUPPORTED_PLATFORMS:
            raise gl.vm.UserError(f"Unsupported platform '{plat}'. Supported: {SUPPORTED_PLATFORMS}")
        if not clean_user or not clean_url:
            raise gl.vm.UserError("username and profile_url must not be empty")

        identity = self.identities.get(caller)
        if identity is not None:
            active_count = 0
            for acct in identity.linked_accounts:
                if acct.proof_status != "REVOKED":
                    active_count += 1
                if acct.platform == plat and acct.username.lower() == clean_user.lower() and acct.proof_status != "REVOKED":
                    raise gl.vm.UserError(f"Already verified @{clean_user} on {plat}")
            if active_count >= MAX_ACCOUNTS_PER_ADDRESS:
                raise gl.vm.UserError(f"Maximum {MAX_ACCOUNTS_PER_ADDRESS} linked accounts reached")

        pkey = self._platform_key(plat, clean_user)
        existing_owner = self.platform_to_address.get(pkey)
        if existing_owner is not None and existing_owner != caller:
            raise gl.vm.UserError(f"@{clean_user} on {plat} is already linked to another wallet address")

        self.request_nonce = u32(int(self.request_nonce) + 1)
        pending_id = self._make_pending_id(caller, plat, clean_user, self.request_nonce)
        self.pending_verifications[caller] = PendingVerification(
            platform=plat,
            username=clean_user,
            profile_url=clean_url,
            verification_code=self._make_code(pending_id),
            pending_id=pending_id,
            request_nonce=self.request_nonce,
        )

    @gl.public.write
    def complete_verification(self, fetch_url: str = "") -> None:
        caller = self._addr(gl.message.sender_address)
        pending = self.pending_verifications.get(caller)
        if pending is None:
            raise gl.vm.UserError("No pending verification. Call request_verification() first.")

        target_url = self._target_url(pending.platform, pending.username, fetch_url)
        verdict = self._evaluate_proof(
            pending.platform,
            pending.username,
            pending.verification_code,
            target_url,
            caller,
            pending.pending_id,
            False,
        )

        if not verdict["code_found"]:
            raise gl.vm.UserError(f"Verification code was not confirmed. Reason: {verdict['reason_code']}")
        if not verdict["account_match"]:
            raise gl.vm.UserError(f"Account ownership could not be confirmed. Reason: {verdict['reason_code']}")
        if verdict["proof_status"] != "ACTIVE":
            raise gl.vm.UserError(f"Proof is not active. Reason: {verdict['reason_code']}")

        marker = self._mark()
        identity = self.identities.get(caller)
        if identity is None:
            identity = IdentityRecord(
                owner=caller,
                linked_accounts=[],
                reputation_score=u32(0),
                is_flagged=False,
                flag_reason="",
                created_at=marker,
                last_updated=marker,
                verification_count=u32(0),
                audit_log=[],
            )
            self.all_addresses.append(caller)
            self.total_identities = u32(int(self.total_identities) + 1)

        audit_ref = self._append_audit(
            identity,
            "verification_completed",
            pending.platform,
            pending.username,
            "approved",
            int(verdict["confidence_bucket"]),
            100 if verdict["risk_band"] == "high" else (50 if verdict["risk_band"] == "medium" else 10),
            verdict["proof_status"],
            verdict["reason_code"],
        )

        dossier = ProofDossier(
            platform=pending.platform,
            username=pending.username,
            canonical_platform_id=verdict["canonical_platform_id"],
            proof_url=target_url,
            verification_code=pending.verification_code,
            pending_id=pending.pending_id,
            proof_strength=verdict["proof_strength"],
            risk_band=verdict["risk_band"],
            confidence_bucket=u32(int(verdict["confidence_bucket"])),
            reason_code=verdict["reason_code"],
            proof_status=verdict["proof_status"],
            verification_method="genlayer-web-consensus",
            verifier_version=VERIFIER_VERSION,
            audit_ref=audit_ref,
            verified_wallet=caller,
            created_marker=marker,
            updated_marker=marker,
        )

        identity.linked_accounts.append(LinkedAccount(
            platform=pending.platform,
            username=pending.username,
            profile_url=pending.profile_url,
            verified_at=marker,
            confidence_score=u32(int(verdict["confidence_bucket"])),
            bot_score=u32(100 if verdict["risk_band"] == "high" else (50 if verdict["risk_band"] == "medium" else 10)),
            reasoning=verdict["reasoning"],
            is_active=True,
            proof_status=verdict["proof_status"],
            proof_strength=verdict["proof_strength"],
            risk_band=verdict["risk_band"],
            canonical_platform_id=verdict["canonical_platform_id"],
            verification_code=pending.verification_code,
            pending_id=pending.pending_id,
            proof_url=target_url,
            reason_code=verdict["reason_code"],
            last_checked_marker=marker,
            dossier=dossier,
        ))

        prev_count = int(identity.verification_count)
        prev_score = int(identity.reputation_score)
        confidence = int(verdict["confidence_bucket"])
        identity.reputation_score = u32((prev_score * prev_count + confidence) // (prev_count + 1))
        identity.verification_count = u32(prev_count + 1)
        identity.last_updated = marker
        self.identities[caller] = identity
        self.platform_to_address[self._platform_key(pending.platform, pending.username)] = caller

        if pending.platform == "discord" and fetch_url:
            self.used_discord_attestations[fetch_url.split("/")[-1]] = True

        del self.pending_verifications[caller]
        self.total_verifications = u32(int(self.total_verifications) + 1)

    @gl.public.write
    def reverify_platform(self, platform: str, username: str, fetch_url: str = "") -> None:
        caller = self._addr(gl.message.sender_address)
        plat = self._normalize_platform(platform)
        pkey = self._platform_key(plat, username)
        owner = self.platform_to_address.get(pkey)
        if owner is None:
            raise gl.vm.UserError("No verified platform proof found")
        if owner != caller and caller != self.admin:
            raise gl.vm.UserError("Only the owner or admin can reverify this proof")

        identity = self.identities.get(owner)
        if identity is None:
            raise gl.vm.UserError("Identity record not found")
        idx = self._find_account(identity, plat, username)
        if idx < 0:
            raise gl.vm.UserError("Linked account not found")
        acct = identity.linked_accounts[idx]
        if acct.proof_status in ("REVOKED", "FLAGGED"):
            raise gl.vm.UserError("Revoked or flagged proofs cannot be reverified until restored")

        target_url = self._target_url(plat, acct.username, fetch_url or acct.proof_url)
        verdict = self._evaluate_proof(plat, acct.username, acct.verification_code, target_url, owner, acct.pending_id, True)
        new_status = verdict["proof_status"]
        if not verdict["code_found"]:
            new_status = "STALE"
        elif not verdict["account_match"]:
            new_status = "CONFLICTED"

        marker = self._mark()
        acct.proof_status = new_status
        acct.proof_strength = verdict["proof_strength"]
        acct.risk_band = verdict["risk_band"]
        acct.confidence_score = u32(int(verdict["confidence_bucket"]))
        acct.bot_score = u32(100 if verdict["risk_band"] == "high" else (50 if verdict["risk_band"] == "medium" else 10))
        acct.reason_code = verdict["reason_code"]
        acct.reasoning = verdict["reasoning"]
        acct.last_checked_marker = marker
        acct.dossier.proof_status = new_status
        acct.dossier.proof_strength = verdict["proof_strength"]
        acct.dossier.risk_band = verdict["risk_band"]
        acct.dossier.confidence_bucket = u32(int(verdict["confidence_bucket"]))
        acct.dossier.reason_code = verdict["reason_code"]
        acct.dossier.updated_marker = marker
        acct.dossier.proof_url = target_url

        audit_ref = self._append_audit(
            identity,
            "proof_reverified",
            plat,
            acct.username,
            new_status.lower(),
            int(verdict["confidence_bucket"]),
            int(acct.bot_score),
            new_status,
            verdict["reason_code"],
        )
        acct.dossier.audit_ref = audit_ref
        identity.linked_accounts[idx] = acct
        identity.last_updated = marker
        self.identities[owner] = identity

    @gl.public.write
    def revoke_platform(self, platform: str, username: str) -> None:
        caller = self._addr(gl.message.sender_address)
        plat = self._normalize_platform(platform)
        pkey = self._platform_key(plat, username)
        owner = self.platform_to_address.get(pkey)
        if owner is None:
            raise gl.vm.UserError(f"No verified link found for @{username} on {plat}")
        if caller != owner and caller != self.admin:
            raise gl.vm.UserError("Only the owner or admin can revoke verified links")
        identity = self.identities.get(owner)
        idx = self._find_account(identity, plat, username)
        if idx < 0:
            raise gl.vm.UserError("Linked account not found")
        marker = self._mark()
        acct = identity.linked_accounts[idx]
        acct.is_active = False
        acct.proof_status = "REVOKED"
        acct.reason_code = "REVOKED_BY_OWNER" if caller == owner else "REVOKED_BY_ADMIN"
        acct.last_checked_marker = marker
        acct.dossier.proof_status = "REVOKED"
        acct.dossier.reason_code = acct.reason_code
        acct.dossier.updated_marker = marker
        identity.linked_accounts[idx] = acct
        self._append_audit(identity, "revoked", plat, username, acct.reason_code, 0, 0, "REVOKED", acct.reason_code)
        identity.last_updated = marker
        self.identities[owner] = identity
        del self.platform_to_address[pkey]

    @gl.public.write
    def cancel_pending_verification(self) -> None:
        caller = self._addr(gl.message.sender_address)
        if self.pending_verifications.get(caller) is None:
            raise gl.vm.UserError("No pending verification to cancel")
        del self.pending_verifications[caller]

    @gl.public.write
    def flag_identity(self, target: str, reason: str) -> None:
        if self._addr(gl.message.sender_address) != self.admin:
            raise gl.vm.UserError("Only the admin can flag identities")
        target = self._addr(target)
        identity = self.identities.get(target)
        if identity is None:
            raise gl.vm.UserError("Identity not found")
        marker = self._mark()
        identity.is_flagged = True
        identity.flag_reason = reason
        for i in range(len(identity.linked_accounts)):
            acct = identity.linked_accounts[i]
            if acct.proof_status != "REVOKED":
                acct.proof_status = "FLAGGED"
                acct.reason_code = "ADMIN_FLAGGED"
                acct.last_checked_marker = marker
                acct.dossier.proof_status = "FLAGGED"
                acct.dossier.reason_code = "ADMIN_FLAGGED"
                acct.dossier.updated_marker = marker
                identity.linked_accounts[i] = acct
        self._append_audit(identity, "admin_flagged", "", "", reason, 0, 0, "FLAGGED", "ADMIN_FLAGGED")
        identity.last_updated = marker
        self.identities[target] = identity

    @gl.public.write
    def unflag_identity(self, target: str) -> None:
        if self._addr(gl.message.sender_address) != self.admin:
            raise gl.vm.UserError("Only the admin can unflag identities")
        target = self._addr(target)
        identity = self.identities.get(target)
        if identity is None:
            raise gl.vm.UserError("Identity not found")
        marker = self._mark()
        identity.is_flagged = False
        identity.flag_reason = ""
        self._append_audit(identity, "admin_unflagged", "", "", "cleared_by_admin", 0, 0, "ACTIVE", "ADMIN_UNFLAGGED")
        identity.last_updated = marker
        self.identities[target] = identity

    @gl.public.write
    def set_discord_attestation_base_url(self, base_url: str) -> None:
        if self._addr(gl.message.sender_address) != self.admin:
            raise gl.vm.UserError("Only the admin can configure Discord attestations")
        clean = base_url.strip().rstrip("/")
        if not clean.startswith("https://") and not clean.startswith("http://"):
            raise gl.vm.UserError("Discord attestation backend must be an http(s) URL")
        old = self.discord_attestation_base_url
        self.discord_attestation_base_url = clean
        identity = self.identities.get(self.admin)
        if identity is not None:
            self._append_audit(identity, "discord_backend_rotated", "discord", "", f"{old}->{clean}", 0, 0, "ACTIVE", "DISCORD_BACKEND_ROTATED")
            self.identities[self.admin] = identity

    @gl.public.write
    def transfer_admin(self, new_admin: str) -> None:
        if self._addr(gl.message.sender_address) != self.admin:
            raise gl.vm.UserError("Only the admin can transfer admin role")
        self.admin = self._addr(new_admin)

    @gl.public.view
    def get_identity(self, address: str) -> dict:
        identity = self.identities.get(self._addr(address))
        if identity is None:
            return {"found": False}
        accounts = []
        for acct in identity.linked_accounts:
            accounts.append({
                "platform": acct.platform,
                "username": acct.username,
                "profile_url": acct.profile_url,
                "verified_at": int(acct.verified_at),
                "confidence_score": int(acct.confidence_score),
                "bot_score": int(acct.bot_score),
                "reasoning": acct.reasoning,
                "is_active": acct.is_active,
                "proof_status": acct.proof_status,
                "proof_strength": acct.proof_strength,
                "risk_band": acct.risk_band,
                "canonical_platform_id": acct.canonical_platform_id,
                "verification_code": acct.verification_code,
                "pending_id": acct.pending_id,
                "proof_url": acct.proof_url,
                "reason_code": acct.reason_code,
                "last_checked_marker": int(acct.last_checked_marker),
                "dossier": {
                    "platform": acct.dossier.platform,
                    "username": acct.dossier.username,
                    "canonical_platform_id": acct.dossier.canonical_platform_id,
                    "proof_url": acct.dossier.proof_url,
                    "verification_code": acct.dossier.verification_code,
                    "pending_id": acct.dossier.pending_id,
                    "proof_strength": acct.dossier.proof_strength,
                    "risk_band": acct.dossier.risk_band,
                    "confidence_bucket": int(acct.dossier.confidence_bucket),
                    "reason_code": acct.dossier.reason_code,
                    "proof_status": acct.dossier.proof_status,
                    "verification_method": acct.dossier.verification_method,
                    "verifier_version": acct.dossier.verifier_version,
                    "audit_ref": int(acct.dossier.audit_ref),
                    "verified_wallet": acct.dossier.verified_wallet,
                    "created_marker": int(acct.dossier.created_marker),
                    "updated_marker": int(acct.dossier.updated_marker),
                },
            })
        return {
            "found": True,
            "owner": identity.owner,
            "linked_accounts": accounts,
            "reputation_score": int(identity.reputation_score),
            "is_flagged": identity.is_flagged,
            "flag_reason": identity.flag_reason,
            "created_at": int(identity.created_at),
            "last_updated": int(identity.last_updated),
            "verification_count": int(identity.verification_count),
        }

    @gl.public.view
    def get_pending_verification(self, address: str) -> dict:
        pending = self.pending_verifications.get(self._addr(address))
        if pending is None:
            return {"found": False}
        return {
            "found": True,
            "platform": pending.platform,
            "username": pending.username,
            "profile_url": pending.profile_url,
            "verification_code": pending.verification_code,
            "pending_id": pending.pending_id,
            "request_nonce": int(pending.request_nonce),
            "requested_at": int(pending.request_nonce),
            "expires_at": 0,
        }

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
        status = identity.linked_accounts[idx].proof_status if idx >= 0 else ""
        return {
            "found": True,
            "owner_address": owner,
            "reputation_score": int(identity.reputation_score),
            "is_flagged": identity.is_flagged,
            "verification_count": int(identity.verification_count),
            "proof_status": status,
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
            "action": e.action,
            "platform": e.platform,
            "username": e.username,
            "result": e.result,
            "confidence": int(e.confidence),
            "bot_score": int(e.bot_score),
            "timestamp": int(e.timestamp),
            "proof_status": e.proof_status,
            "reason_code": e.reason_code,
        } for e in identity.audit_log]

    @gl.public.view
    def get_all_addresses(self, offset: u32, limit: u32) -> list:
        start = int(offset)
        end = min(start + int(limit), len(self.all_addresses))
        return [self.all_addresses[i] for i in range(start, end)]

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "total_verifications": int(self.total_verifications),
            "total_identities": int(self.total_identities),
            "admin": self.admin,
            "supported_platforms": SUPPORTED_PLATFORMS,
            "proof_statuses": PROOF_STATUSES,
            "verifier_version": VERIFIER_VERSION,
            "discord_attestation_base_url": self.discord_attestation_base_url,
        }
