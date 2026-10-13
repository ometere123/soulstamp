import json
import os
import re
import sys
from datetime import datetime, timezone


CONTRACT = "contracts/soul_stamp.py"
ADMIN = "0x" + "11" * 20
OWNER = "0x" + "22" * 20
CHALLENGER = "0x" + "33" * 20
OTHER = "0x" + "44" * 20


def deploy(direct_deploy):
    return direct_deploy(
        CONTRACT,
        ADMIN,
        "",
        sdk_version=os.environ.get("GENVM_VERSION", "v0.2.16"),
    )


def proof_llm(vm, *, account_match=True, canonical_id="42", decision=None, reason_code=None, reasoning="direct-mode evidence fixture"):
    if decision is not None:
        vm.mock_llm(
            r"(?s).*independent SoulStamp ownership challenge resolution.*",
            json.dumps({"decision": decision, "reasoning": "independent evidence comparison"}),
        )
        return
    vm.mock_llm(
        r"(?s).*SoulStamp identity evidence decision.*",
        json.dumps({
            "code_found": True,
            "account_match": account_match,
            "canonical_platform_id": str(canonical_id),
            "proof_strength": "STRONG",
            "risk_band": "low" if account_match else "high",
            "confidence_bucket": 92 if account_match else 20,
            "reason_code": reason_code or ("CODE_FOUND_ON_CANONICAL_PROFILE" if account_match else "ACCOUNT_MISMATCH"),
            "reasoning": reasoning,
        }),
    )


def proof_llm_payload(vm, payload):
    """Return deliberately incomplete or contradictory AI output."""
    vm.mock_llm(
        r"(?s).*SoulStamp identity evidence decision.*",
        json.dumps(payload),
    )


def github_web(vm, username, code, *, canonical_id="42", login=None):
    vm.mock_web(
        rf".*api\.github\.com/users/{re.escape(username)}$",
        {
            "status": 200,
            "body": json.dumps({
                "login": login or username,
                "id": int(canonical_id) if str(canonical_id).isdigit() else str(canonical_id),
                "bio": code,
            }),
        },
    )


def verify_github(vm, contract, wallet, username="alice", canonical_id="42"):
    vm.sender = wallet
    contract.request_verification("github", username, f"https://github.com/{username}")
    pending = contract.get_pending_verification(wallet)
    github_web(vm, username, pending["verification_code"], canonical_id=canonical_id)
    proof_llm(vm, canonical_id=canonical_id)
    contract.complete_verification("")
    return pending


def test_request_and_pending_state(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("github", "alice", "https://github.com/alice")
    pending = contract.get_pending_verification(OWNER)
    assert pending["found"] is True
    assert pending["pending_id"]
    assert pending["expires_at"] > pending["requested_at"]
    assert contract.get_identity(OWNER)["found"] is False


def test_x_author_impersonation_is_rejected(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("twitter", "claimed", "https://twitter.com/claimed")
    pending = contract.get_pending_verification(OWNER)
    direct_vm.mock_web(
        r".*publish\.twitter\.com/oembed.*",
        {"status": 200, "body": json.dumps({
            "author_url": "https://x.com/attacker",
            "author_id": "555",
            "html": f"<p>{pending['verification_code']}</p>",
        })},
    )
    proof_llm(direct_vm, account_match=False, canonical_id="id:555")
    with direct_vm.expect_revert("ownership"):
        contract.complete_verification("https://x.com/claimed/status/123456")


def test_x_oembed_handle_only_proof_is_accepted_but_not_recovery_grade(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("twitter", "claimed", "https://x.com/claimed/status/123456")
    pending = contract.get_pending_verification(OWNER)
    direct_vm.mock_web(
        r".*publish\.twitter\.com/oembed.*",
        {"status": 200, "body": json.dumps({
            "url": "https://x.com/claimed/status/123456",
            "author_name": "Claimed",
            "author_url": "https://x.com/claimed",
            "html": f"<blockquote>{pending['verification_code']}</blockquote>",
            "provider_name": "X",
            "provider_url": "https://x.com",
        })},
    )
    proof_llm(direct_vm, account_match=True, canonical_id="")
    contract.complete_verification("https://x.com/claimed/status/123456")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    assert account["proof_status"] == "ACTIVE"
    assert account["canonical_platform_id"] == ""
    assert account["proof_strength"] == "MEDIUM"
    assert account["reason_code"] == "CODE_FOUND_ON_CANONICAL_TWEET_HANDLE_ONLY"
    direct_vm.sender = CHALLENGER
    with direct_vm.expect_revert("canonical identity evidence"):
        contract.request_ownership_challenge("twitter", "claimed")


def test_x_rejects_non_provider_author_url_even_when_path_matches(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("twitter", "claimed", "https://x.com/claimed/status/123456")
    pending = contract.get_pending_verification(OWNER)
    direct_vm.mock_web(
        r".*publish\.twitter\.com/oembed.*",
        {"status": 200, "body": json.dumps({
            "author_url": "https://evil.example/claimed",
            "author_id": "555",
            "html": f"<p>{pending['verification_code']}</p>",
        })},
    )
    proof_llm(direct_vm, account_match=False, canonical_id="id:555")
    with direct_vm.expect_revert("ownership"):
        contract.complete_verification("https://x.com/claimed/status/123456")


def test_x_rejects_http_provider_author_url_even_when_identity_matches(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("twitter", "claimed", "https://x.com/claimed/status/123456")
    pending = contract.get_pending_verification(OWNER)
    direct_vm.mock_web(
        r".*publish\.twitter\.com/oembed.*",
        {"status": 200, "body": json.dumps({
            "author_url": "http://x.com/claimed",
            "author_id": "555",
            "html": f"<p>{pending['verification_code']}</p>",
        })},
    )
    proof_llm(direct_vm, account_match=False, canonical_id="id:555")
    with direct_vm.expect_revert("ownership"):
        contract.complete_verification("https://x.com/claimed/status/123456")


def test_x_real_oembed_shape_does_not_require_unsupported_author_id(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("twitter", "papito_dele", "https://x.com/papito_dele")
    pending = contract.get_pending_verification(OWNER)
    direct_vm.mock_web(
        r".*publish\.twitter\.com/oembed.*",
        {"status": 200, "body": json.dumps({
            "url": "https://x.com/papito_dele/status/2109798117659009109",
            "author_name": "PAPITO",
            "author_url": "https://x.com/papito_dele",
            "html": f"<blockquote><p>Verifying my identity on SoulStamp<br>{pending['verification_code']}</p></blockquote>",
            "provider_name": "X",
            "provider_url": "https://x.com",
            "version": "1.0",
        })},
    )
    proof_llm(direct_vm, account_match=True, canonical_id="", reasoning="Provider oEmbed confirms the exact HTTPS author handle; no immutable ID was returned.")
    contract.complete_verification("https://x.com/papito_dele/status/2109798117659009109")
    assert contract.lookup_by_platform("twitter", "papito_dele")["proof_status"] == "ACTIVE"


def test_llm_reason_code_and_reasoning_variance_cannot_change_derived_status(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("github", "alice", "https://github.com/alice")
    pending = contract.get_pending_verification(OWNER)
    github_web(direct_vm, "alice", pending["verification_code"], canonical_id="42")
    proof_llm(
        direct_vm,
        canonical_id="42",
        reason_code="LLM_WORDING_CHANGED",
        reasoning="A long provider-specific explanation that is not protocol state.",
    )
    contract.complete_verification("")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    assert account["proof_status"] == "ACTIVE"
    assert account["reason_code"] == "CODE_FOUND_ON_CANONICAL_PROFILE"


def test_policy_confidence_ignores_missing_zero_and_contradictory_ai_scores_for_all_platforms(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    direct_vm.warp("2030-01-01T00:00:00Z")

    # GitHub: the provider proves the exact login, numeric ID, and code while
    # the model omits/contradicts the material fields and reports zero.
    contract.request_verification("github", "alice", "https://github.com/alice")
    github_pending = contract.get_pending_verification(OWNER)
    github_web(direct_vm, "alice", github_pending["verification_code"], canonical_id="42")
    proof_llm_payload(direct_vm, {
        "code_found": False,
        "account_match": False,
        "canonical_platform_id": "42",
        "confidence_bucket": 0,
        "reasoning": "The provider response contains the exact requested account and code.",
    })
    contract.complete_verification("")

    # X: real oEmbed shape has no immutable author ID. The exact HTTPS
    # provider author URL therefore remains MEDIUM/handle-only at 82.
    direct_vm.clear_mocks()
    contract.request_verification("twitter", "claimed", "https://x.com/claimed/status/123456")
    x_pending = contract.get_pending_verification(OWNER)
    direct_vm.mock_web(
        r".*publish\.twitter\.com/oembed.*",
        {"status": 200, "body": json.dumps({
            "url": "https://x.com/claimed/status/123456",
            "author_name": "Claimed",
            "author_url": "https://x.com/claimed",
            "html": f"<blockquote>{x_pending['verification_code']}</blockquote>",
            "provider_name": "X",
            "provider_url": "https://x.com",
        })},
    )
    proof_llm_payload(direct_vm, {
        "code_found": False,
        "account_match": False,
        "canonical_platform_id": "forged-immutable-id",
        "confidence_bucket": 0,
        "proof_strength": "STRONG",
        "risk_band": "low",
        "reasoning": "The provider returned the exact author handle but no immutable ID.",
    })
    contract.complete_verification("https://x.com/claimed/status/123456")

    # Discord: Worker-shaped signed token and fresh attestation are enough for
    # the deterministic 94 policy score even when the model omits all fields.
    direct_vm.clear_mocks()
    direct_vm.sender = ADMIN
    contract.set_discord_attestation_base_url("https://attest.example")
    direct_vm.sender = OWNER
    contract.request_verification("discord", "alice#123", "https://discord.com/users/123")
    discord_pending = contract.get_pending_verification(OWNER)
    token = "eyJwdXJwb3NlIjoiZGlzY29yZF9hdHRlc3RhdGlvbiJ9" + "C" * 1040 + "." + "c" * 43
    discord_url = f"https://attest.example/api/discord/attestations/{token}"
    direct_vm.mock_web(
        r".*attest\.example/api/discord/attestations/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$",
        {"status": 200, "body": json.dumps({
            "discord_user_id": "123",
            "issuer": "https://attest.example", "nonce": "confidence-nonce", "attestation_id": "confidence-attestation",
            "wallet": OWNER,
            "verification_code": discord_pending["verification_code"],
            "claimed_username": "alice#123",
            "pending_id": discord_pending["pending_id"],
            "issued_at": 1893455990,
            "expires_at": 1893456300,
        })},
    )
    proof_llm_payload(direct_vm, {"reasoning": "Fresh Worker attestation matches the wallet, code, and Discord ID."})
    contract.complete_verification(discord_url)

    identity = contract.get_identity(OWNER)
    scores = [account["confidence_score"] for account in identity["linked_accounts"]]
    dossier_scores = [account["dossier"]["confidence_bucket"] for account in identity["linked_accounts"]]
    assert scores == [92, 82, 94]
    assert dossier_scores == scores
    assert [account["proof_status"] for account in identity["linked_accounts"]] == ["ACTIVE"] * 3
    assert identity["linked_accounts"][1]["proof_strength"] == "MEDIUM"
    assert identity["linked_accounts"][1]["risk_band"] == "medium"
    assert identity["reputation_score"] == 89

    # Reverification must apply the same policy score to both account and
    # dossier, without letting a fresh contradictory AI response zero it.
    direct_vm.clear_mocks()
    direct_vm.sender = OWNER
    github_web(direct_vm, "alice", github_pending["verification_code"], canonical_id="42")
    proof_llm_payload(direct_vm, {
        "code_found": False,
        "account_match": False,
        "confidence_bucket": 0,
        "reasoning": "Fresh provider evidence still matches.",
    })
    contract.reverify_platform("github", "alice")
    github_account = contract.get_identity(OWNER)["linked_accounts"][0]
    assert github_account["confidence_score"] == 92
    assert github_account["dossier"]["confidence_bucket"] == 92
    assert contract.get_identity(OWNER)["reputation_score"] == 89


def test_external_evidence_failure_is_classified_and_does_not_create_identity(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("github", "alice", "https://github.com/alice")
    direct_vm.mock_web(
        r".*api\.github\.com/users/alice$",
        {"status": 503, "body": "provider unavailable"},
    )
    with direct_vm.expect_revert("Evidence source returned HTTP 503"):
        contract.complete_verification("")
    assert contract.get_identity(OWNER)["found"] is False
    assert contract.get_pending_verification(OWNER)["found"] is True


def test_canonical_id_is_unique_across_handles(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = OTHER
    contract.request_verification("github", "alice_alt", "https://github.com/alice_alt")
    pending = contract.get_pending_verification(OTHER)
    github_web(direct_vm, "alice_alt", pending["verification_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    with direct_vm.expect_revert("Canonical platform ID"):
        contract.complete_verification("")


def test_adversarial_validator_cannot_change_canonical_identity(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    forged_leader_result = {
        "code_found": True,
        "account_match": True,
        "platform": "github",
        "username": "alice",
        "canonical_platform_id": "attacker-controlled-id",
        "reason_code": "CODE_FOUND_ON_CANONICAL_PROFILE",
        "proof_status": "ACTIVE",
        "confidence_bucket": 92,
    }
    assert direct_vm.run_validator(leader_result=forged_leader_result) is False


def test_revoke_clears_indexes_and_allows_relink(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    assert contract.is_platform_taken("github", "alice") is True
    direct_vm.sender = OWNER
    contract.revoke_platform("github", "alice")
    assert contract.is_platform_taken("github", "alice") is False
    assert contract.lookup_by_platform("github", "alice")["found"] is False
    direct_vm.clear_mocks()
    contract.request_verification("github", "alice", "https://github.com/alice")
    pending = contract.get_pending_verification(OWNER)
    github_web(direct_vm, "alice", pending["verification_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.complete_verification("")
    assert contract.get_identity(OWNER)["linked_accounts"][0]["proof_status"] == "ACTIVE"
    assert contract.is_platform_taken("github", "alice") is True


def test_github_reverification_uses_public_profile_locator(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    verification_code = contract.get_identity(OWNER)["linked_accounts"][0]["verification_code"]
    direct_vm.clear_mocks()
    direct_vm.sender = OWNER
    github_web(direct_vm, "alice", verification_code, canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.reverify_platform("github", "alice")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    assert account["proof_status"] == "ACTIVE"
    assert account["dossier"]["proof_url"] == "https://api.github.com/users/alice"


def test_reverification_cannot_replace_canonical_binding(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = OWNER
    github_web(direct_vm, "alice", contract.get_identity(OWNER)["linked_accounts"][0]["verification_code"], canonical_id="99")
    proof_llm(direct_vm, canonical_id="99")
    contract.reverify_platform("github", "alice")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    assert account["proof_status"] == "CONFLICTED"
    assert account["is_active"] is False
    assert account["reason_code"] == "CANONICAL_ID_CHANGED"
    assert account["canonical_platform_id"] == "42"
    assert account["dossier"]["canonical_platform_id"] == "42"
    assert contract.lookup_by_platform("github", "alice")["canonical_platform_id"] == "42"
    assert contract.is_eligible(OWNER) is False


def test_expired_proof_can_enter_safe_stale_reclamation_flow(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    expires_at = account["dossier"]["evidence_expires_at"]
    direct_vm.warp(datetime.fromtimestamp(expires_at + 1, tz=timezone.utc).isoformat())
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    assert challenge["status"] == "OPEN"
    assert contract.is_platform_taken("github", "alice") is True


def test_expired_proof_is_reported_stale_and_ineligible(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    direct_vm.warp(datetime.fromtimestamp(account["dossier"]["evidence_expires_at"] + 1, tz=timezone.utc).isoformat())

    reported = contract.get_identity(OWNER)
    assert reported["linked_accounts"][0]["proof_status"] == "STALE"
    assert reported["linked_accounts"][0]["is_active"] is False
    assert reported["linked_accounts"][0]["reason_code"] == "EVIDENCE_EXPIRED"
    assert reported["eligible"] is False
    assert contract.lookup_by_platform("github", "alice")["proof_status"] == "STALE"


def test_unflag_does_not_restore_expired_proof_to_active(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    direct_vm.warp(datetime.fromtimestamp(account["dossier"]["evidence_expires_at"] + 1, tz=timezone.utc).isoformat())
    direct_vm.sender = ADMIN
    contract.flag_identity(OWNER, "manual review")
    contract.unflag_identity(OWNER)

    reported = contract.get_identity(OWNER)
    assert reported["linked_accounts"][0]["proof_status"] == "STALE"
    assert reported["linked_accounts"][0]["is_active"] is False
    assert reported["eligible"] is False


def test_invalid_challenger_evidence_does_not_advance_challenge(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42", login="attacker")
    proof_llm(direct_vm, account_match=False, canonical_id="42")
    with direct_vm.expect_revert("Fresh challenger evidence"):
        contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
    assert contract.get_challenge(challenge["challenge_id"])["status"] == "OPEN"


def test_challenge_evidence_cannot_switch_canonical_platform_id(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="99")
    proof_llm(direct_vm, canonical_id="99")

    with direct_vm.expect_revert("challenged canonical platform ID"):
        contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
    assert contract.get_challenge(challenge["challenge_id"])["status"] == "OPEN"


def test_unanswered_challenge_expires_and_releases_slot(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    direct_vm.warp(datetime.fromtimestamp(challenge["challenger_evidence_deadline"] + 1, tz=timezone.utc).isoformat())
    direct_vm.sender = OTHER
    contract.expire_ownership_challenge(challenge["challenge_id"])
    expired = contract.get_challenge(challenge["challenge_id"])
    assert expired["status"] == "EXPIRED"
    assert expired["outcome"] == "NO_CHALLENGER_EVIDENCE"

    contract.request_ownership_challenge("github", "alice")
    replacement = contract.get_challenges(OTHER, 0, 10)[0]
    assert replacement["status"] == "OPEN"
    assert replacement["challenge_id"] != challenge["challenge_id"]


def test_revocation_expires_an_open_challenge(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge_id = contract.get_challenges(CHALLENGER, 0, 10)[0]["challenge_id"]
    direct_vm.sender = OWNER
    contract.revoke_platform("github", "alice")
    challenge = contract.get_challenge(challenge_id)
    assert challenge["status"] == "EXPIRED"
    assert challenge["outcome"] == "OWNER_REVOKED"
    assert contract.is_platform_taken("github", "alice") is False


def test_admin_flag_expires_an_open_challenge(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge_id = contract.get_challenges(CHALLENGER, 0, 10)[0]["challenge_id"]
    direct_vm.sender = ADMIN
    contract.flag_identity(OWNER, "manual review")
    challenge = contract.get_challenge(challenge_id)
    assert challenge["status"] == "EXPIRED"
    assert challenge["outcome"] == "OWNER_FLAGGED"


def test_rebuttal_statement_is_bounded(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    assert challenge["rebuttal_deadline"] == 0
    assert challenge["challenger_evidence_deadline"] > challenge["opened_at"]
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
    accepted = contract.get_challenge(challenge["challenge_id"])
    assert accepted["rebuttal_deadline"] > accepted["challenger_evidence_accepted_at"]
    assert accepted["rebuttal_deadline"] == accepted["challenger_evidence_accepted_at"] + 30 * 60
    direct_vm.sender = OWNER
    with direct_vm.expect_revert("2000 characters"):
        contract.respond_to_challenge(challenge["challenge_id"], "https://github.com/alice", "x" * 2001)
    assert contract.get_challenge(challenge["challenge_id"])["status"] == "AWAITING_REBUTTAL"


def test_owner_rebuttal_cannot_switch_canonical_platform_id(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")

    direct_vm.sender = OWNER
    direct_vm.clear_mocks()
    github_web(direct_vm, "alice", challenge["owner_rebuttal_code"], canonical_id="99")
    proof_llm(direct_vm, canonical_id="99")
    with direct_vm.expect_revert("challenged canonical platform ID"):
        contract.respond_to_challenge(
            challenge["challenge_id"],
            "https://github.com/alice",
            "I retain the account.",
        )
    assert contract.get_challenge(challenge["challenge_id"])["status"] == "AWAITING_REBUTTAL"


def test_owner_cannot_rebut_before_challenger_evidence(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]

    direct_vm.sender = OWNER
    with direct_vm.expect_revert("Submit challenger evidence"):
        contract.respond_to_challenge(
            challenge["challenge_id"],
            "https://github.com/alice",
            "I retain the account.",
        )
    assert contract.get_challenge(challenge["challenge_id"])["status"] == "OPEN"


def test_flag_keeps_status_and_active_consistent(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER)
    direct_vm.sender = ADMIN
    contract.flag_identity(OWNER, "manual review")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    assert account["proof_status"] == "FLAGGED"
    assert account["is_active"] is False
    contract.unflag_identity(OWNER)
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    assert account["proof_status"] == "ACTIVE"
    assert account["is_active"] is True


def test_discord_attestation_is_fresh_and_one_use(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = ADMIN
    contract.set_discord_attestation_base_url("https://attest.example")
    direct_vm.warp("2030-01-01T00:00:00Z")
    direct_vm.sender = OWNER
    contract.request_verification("discord", "alice#123", "https://discord.com/users/123")
    pending = contract.get_pending_verification(OWNER)
    attestation_token = "A" * 100 + "." + "a" * 43
    attestation_url = f"https://attest.example/api/discord/attestations/{attestation_token}"
    body = {
        "discord_user_id": "123", "issuer": "https://attest.example", "nonce": "fresh-owner-nonce", "attestation_id": "fresh-owner-attestation", "wallet": OWNER,
        "verification_code": pending["verification_code"],
        "claimed_username": "alice#123", "pending_id": pending["pending_id"],
        "issued_at": 1893455990, "expires_at": 1893456300,
    }
    direct_vm.mock_web(r".*attest\.example/api/discord/attestations/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$", {"status": 200, "body": json.dumps(body)})
    proof_llm(direct_vm, canonical_id="123")
    with direct_vm.expect_revert("configured backend"):
        contract.complete_verification(attestation_url + "?replay=1")
    contract.complete_verification(attestation_url)
    with direct_vm.expect_revert("already been used"):
        contract.reverify_platform("discord", "alice#123", attestation_url)


def test_expired_discord_attestation_is_not_active(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = ADMIN
    contract.set_discord_attestation_base_url("https://attest.example")
    direct_vm.warp("2030-01-01T00:00:00Z")
    direct_vm.sender = OTHER
    contract.request_verification("discord", "expired#123", "https://discord.com/users/123")
    pending = contract.get_pending_verification(OTHER)
    attestation_token = "B" * 100 + "." + "b" * 43
    attestation_url = f"https://attest.example/api/discord/attestations/{attestation_token}"
    body = {
        "discord_user_id": "123", "issuer": "https://attest.example", "nonce": "expired-nonce", "attestation_id": "expired-attestation", "wallet": OTHER,
        "verification_code": pending["verification_code"],
        "claimed_username": "expired#123", "pending_id": pending["pending_id"],
        "issued_at": 1893455000, "expires_at": 1893455999,
    }
    direct_vm.mock_web(r".*attest\.example/api/discord/attestations/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$", {"status": 200, "body": json.dumps(body)})
    proof_llm(direct_vm, account_match=False, canonical_id="123")
    with direct_vm.expect_revert("ownership"):
        contract.complete_verification(attestation_url)


def test_challenge_deadline_resolution_and_safe_recovery(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    assert challenge["status"] == "OPEN"
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
    direct_vm.mock_web(
        r".*api\.github\.com/users/alice$",
        {"status": 200, "body": json.dumps({"bio": challenge["challenger_code"], "login": "alice", "id": 42})},
    )
    with direct_vm.expect_revert("Wait for the rebuttal deadline"):
        contract.resolve_ownership_challenge(challenge["challenge_id"])
    deadline_time = datetime.fromtimestamp(contract.get_challenge(challenge["challenge_id"])["rebuttal_deadline"] + 1, tz=timezone.utc)
    direct_vm.warp(deadline_time.isoformat())
    proof_llm(direct_vm, decision="CHALLENGER_UPHOLDS")
    contract.resolve_ownership_challenge(challenge["challenge_id"])
    assert direct_vm.run_validator(leader_result={"decision": "OWNER_UPHOLDS", "reasoning": "forged"}) is False
    resolved = contract.get_challenge(challenge["challenge_id"])
    assert resolved["status"] == "RESOLVED_CHALLENGER"
    with direct_vm.expect_revert("safety delay"):
        contract.execute_wallet_recovery(challenge["challenge_id"])
    direct_vm.sender = OTHER
    with direct_vm.expect_revert("winning wallet"):
        contract.execute_wallet_recovery(challenge["challenge_id"])
    recovery_time = datetime.fromtimestamp(resolved["recovery_not_before"] + 1, tz=timezone.utc)
    direct_vm.warp(recovery_time.isoformat())
    direct_vm.sender = CHALLENGER
    contract.execute_wallet_recovery(challenge["challenge_id"])
    old_identity = contract.get_identity(OWNER)
    new_identity = contract.get_identity(CHALLENGER)
    assert old_identity["identity_state"] == "RECOVERED"
    assert old_identity["eligible"] is False
    assert new_identity["identity_state"] == "ACTIVE"
    assert new_identity["eligible"] is True
    assert contract.get_audit_log(CHALLENGER)[-1]["event_hash"]
    assert contract.lookup_by_platform("github", "alice")["owner_address"] == CHALLENGER


def test_challenge_cannot_accept_owner_win_over_active_challenger_evidence(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
    direct_vm.mock_web(
        r".*api\.github\.com/users/alice$",
        {"status": 200, "body": json.dumps({"bio": challenge["challenger_code"], "login": "alice", "id": 42})},
    )
    direct_vm.warp(datetime.fromtimestamp(contract.get_challenge(challenge["challenge_id"])["rebuttal_deadline"] + 1, tz=timezone.utc).isoformat())
    proof_llm(direct_vm, decision="OWNER_UPHOLDS")
    with direct_vm.expect_revert("independently derived evidence"):
        contract.resolve_ownership_challenge(challenge["challenge_id"])
    assert contract.get_challenge(challenge["challenge_id"])["status"] == "AWAITING_REBUTTAL"
    assert contract.get_identity(OWNER)["linked_accounts"][0]["proof_status"] == "ACTIVE"


def test_challenge_resolution_fails_closed_on_source_fetch_error(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
    direct_vm.mock_web(
        r".*api\.github\.com/users/alice$",
        {"status": 503, "body": "temporary upstream failure"},
    )
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r".*api\.github\.com/users/alice$",
        {"status": 503, "body": "temporary upstream failure"},
    )
    direct_vm.warp(datetime.fromtimestamp(contract.get_challenge(challenge["challenge_id"])["rebuttal_deadline"] + 1, tz=timezone.utc).isoformat())
    with direct_vm.expect_revert("Challenge evidence source returned HTTP 503"):
        contract.resolve_ownership_challenge(challenge["challenge_id"])
    assert contract.get_challenge(challenge["challenge_id"])["status"] == "AWAITING_REBUTTAL"
    assert contract.get_identity(OWNER)["linked_accounts"][0]["proof_status"] == "ACTIVE"


def test_challenge_owner_rebuttal_can_force_inconclusive(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge_id = contract.get_challenges(CHALLENGER, 0, 10)[0]["challenge_id"]
    challenge = contract.get_challenge(challenge_id)
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge_id, "https://github.com/alice")
    direct_vm.sender = OWNER
    direct_vm.clear_mocks()
    github_web(direct_vm, "alice", challenge["owner_rebuttal_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.respond_to_challenge(challenge_id, "https://github.com/alice", "I retain the account.")
    direct_vm.mock_web(
        r".*api\.github\.com/users/alice$",
        {"status": 200, "body": json.dumps({"bio": challenge["owner_rebuttal_code"], "login": "alice", "id": 42})},
    )
    proof_llm(direct_vm, decision="INCONCLUSIVE")
    contract.resolve_ownership_challenge(challenge_id)
    assert contract.get_challenge(challenge_id)["status"] == "RESOLVED_INCONCLUSIVE"
    owner_identity = contract.get_identity(OWNER)
    assert owner_identity["linked_accounts"][0]["proof_status"] == "CONFLICTED"
    assert owner_identity["linked_accounts"][0]["is_active"] is False
    assert owner_identity["eligible"] is False


def test_recovery_preserves_non_revoked_historical_indexes(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    direct_vm.clear_mocks()
    verify_github(direct_vm, contract, OWNER, "bob", "43")

    direct_vm.clear_mocks()
    direct_vm.sender = OWNER
    direct_vm.mock_web(
        r".*api\.github\.com/users/bob$",
        {"status": 200, "body": json.dumps({"login": "bob", "id": 43, "bio": "no current proof"})},
    )
    direct_vm.mock_llm(
        r"(?s).*SoulStamp identity evidence decision.*",
        json.dumps({
            "code_found": False, "account_match": True, "canonical_platform_id": "43",
            "proof_strength": "STRONG", "risk_band": "low", "confidence_bucket": 10,
            "reason_code": "CODE_NOT_FOUND", "reasoning": "expired public proof",
        }),
    )
    contract.reverify_platform("github", "bob")
    assert contract.lookup_by_platform("github", "bob")["proof_status"] == "STALE"
    assert contract.is_platform_taken("github", "bob") is True

    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
    direct_vm.mock_web(
        r".*api\.github\.com/users/alice$",
        {"status": 200, "body": json.dumps({"bio": challenge["challenger_code"], "login": "alice", "id": 42})},
    )
    direct_vm.warp(datetime.fromtimestamp(contract.get_challenge(challenge["challenge_id"])["rebuttal_deadline"] + 1, tz=timezone.utc).isoformat())
    proof_llm(direct_vm, decision="CHALLENGER_UPHOLDS")
    contract.resolve_ownership_challenge(challenge["challenge_id"])
    resolved = contract.get_challenge(challenge["challenge_id"])
    direct_vm.warp(datetime.fromtimestamp(resolved["recovery_not_before"] + 1, tz=timezone.utc).isoformat())
    direct_vm.sender = CHALLENGER
    contract.execute_wallet_recovery(challenge["challenge_id"])

    bob_after = contract.lookup_by_platform("github", "bob")
    assert bob_after["owner_address"] == OWNER
    assert bob_after["proof_status"] == "STALE"
    assert contract.is_platform_taken("github", "bob") is True
    challenger_identity = contract.get_identity(CHALLENGER)
    assert [account["username"] for account in challenger_identity["linked_accounts"]] == ["alice"]
    assert challenger_identity["reputation_score"] == 0


def test_discord_challenge_attestation_is_consumed_once(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = ADMIN
    contract.set_discord_attestation_base_url("https://attest.example")
    direct_vm.warp("2030-01-01T00:00:00Z")
    direct_vm.sender = OWNER
    contract.request_verification("discord", "alice#123", "https://discord.com/users/123")
    pending = contract.get_pending_verification(OWNER)
    verification_token = "eyJwdXJwb3NlIjoiZGlzY29yZF9hdHRlc3RhdGlvbiJ9" + "A" * 1040 + "." + "a" * 43
    assert len(verification_token) > 256
    verification_url = f"https://attest.example/api/discord/attestations/{verification_token}"
    verification_body = {
        "discord_user_id": "123", "issuer": "https://attest.example", "nonce": "verification-nonce", "attestation_id": "verification-attestation", "wallet": OWNER,
        "verification_code": pending["verification_code"],
        "claimed_username": "alice#123", "pending_id": pending["pending_id"],
        "issued_at": 1893455990, "expires_at": 1893456300,
    }
    direct_vm.mock_web(r".*attest\.example/api/discord/attestations/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$", {"status": 200, "body": json.dumps(verification_body)})
    proof_llm(direct_vm, canonical_id="123")
    contract.complete_verification(verification_url)
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("discord", "alice#123")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    challenge_token = "eyJwdXJwb3NlIjoiZGlzY29yZF9hdHRlc3RhdGlvbiJ9" + "B" * 1040 + "." + "b" * 43
    assert len(challenge_token) > 256
    challenge_url = f"https://attest.example/api/discord/attestations/{challenge_token}"
    challenge_body = {
        "discord_user_id": "123", "issuer": "https://attest.example", "nonce": "challenge-nonce", "attestation_id": "challenge-attestation", "wallet": CHALLENGER,
        "verification_code": challenge["challenger_code"],
        "claimed_username": "alice#123", "pending_id": challenge["challenge_id"],
        "issued_at": 1893455990, "expires_at": 1893456300,
    }
    direct_vm.mock_web(r".*attest\.example/api/discord/attestations/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$", {"status": 200, "body": json.dumps(challenge_body)})
    proof_llm(direct_vm, canonical_id="123")
    contract.submit_challenge_evidence(challenge["challenge_id"], challenge_url)
    direct_vm.sender = OWNER
    with direct_vm.expect_revert("already been used"):
        contract.respond_to_challenge(challenge["challenge_id"], challenge_url, "The current owner retains this account.")


def test_discord_challenge_resolves_from_snapshot_after_attestation_expiry(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = ADMIN
    contract.set_discord_attestation_base_url("https://attest.example")
    direct_vm.warp("2030-01-01T00:00:00Z")
    direct_vm.sender = OWNER
    contract.request_verification("discord", "alice#123", "https://discord.com/users/123")
    pending = contract.get_pending_verification(OWNER)
    owner_token = "O" * 100 + "." + "o" * 43
    owner_url = f"https://attest.example/api/discord/attestations/{owner_token}"
    direct_vm.mock_web(
        r".*attest\.example/api/discord/attestations/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$",
        {"status": 200, "body": json.dumps({
            "discord_user_id": "123", "issuer": "https://attest.example", "nonce": "owner-live-nonce", "attestation_id": "owner-live-attestation", "wallet": OWNER,
            "verification_code": pending["verification_code"], "claimed_username": "alice#123", "pending_id": pending["pending_id"],
            "issued_at": 1893455990, "expires_at": 1893456300,
        })},
    )
    proof_llm(direct_vm, canonical_id="123")
    contract.complete_verification(owner_url)

    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("discord", "alice#123")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    challenge_token = "N" * 100 + "." + "n" * 43
    challenge_url = f"https://attest.example/api/discord/attestations/{challenge_token}"
    direct_vm.mock_web(
        r".*attest\.example/api/discord/attestations/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$",
        {"status": 200, "body": json.dumps({
            "discord_user_id": "123", "issuer": "https://attest.example", "nonce": "challenger-snapshot-nonce", "attestation_id": "challenger-snapshot-attestation", "wallet": CHALLENGER,
            "verification_code": challenge["challenger_code"], "claimed_username": "alice#123", "pending_id": challenge["challenge_id"],
            "issued_at": 1893455990, "expires_at": 1893456300,
        })},
    )
    proof_llm(direct_vm, canonical_id="123")
    contract.submit_challenge_evidence(challenge["challenge_id"], challenge_url)
    accepted = contract.get_challenge(challenge["challenge_id"])
    assert accepted["challenger_evidence_hash"]
    assert accepted["challenger_evidence_commitment"]
    assert accepted["challenger_evidence_expires_at"] < accepted["rebuttal_deadline"]

    # The Worker URL is now expired and is deliberately unavailable. The
    # resolver must use the accepted immutable snapshot, not refetch it.
    direct_vm.clear_mocks()
    direct_vm.warp(datetime.fromtimestamp(accepted["rebuttal_deadline"] + 1, tz=timezone.utc).isoformat())
    proof_llm(direct_vm, decision="CHALLENGER_UPHOLDS")
    contract.resolve_ownership_challenge(challenge["challenge_id"])
    resolved = contract.get_challenge(challenge["challenge_id"])
    assert resolved["status"] == "RESOLVED_CHALLENGER"
    assert resolved["outcome"] == "CHALLENGER_UPHOLDS"


def test_stale_canonical_account_requires_fresh_challenger_evidence_before_recovery(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    direct_vm.warp(datetime.fromtimestamp(account["dossier"]["evidence_expires_at"] + 1, tz=timezone.utc).isoformat())
    assert contract.lookup_by_platform("github", "alice")["proof_status"] == "STALE"
    assert contract.is_platform_taken("github", "alice") is True

    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("github", "alice")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
    accepted = contract.get_challenge(challenge["challenge_id"])
    direct_vm.warp(datetime.fromtimestamp(accepted["rebuttal_deadline"] + 1, tz=timezone.utc).isoformat())
    proof_llm(direct_vm, decision="CHALLENGER_UPHOLDS")
    contract.resolve_ownership_challenge(challenge["challenge_id"])
    resolved = contract.get_challenge(challenge["challenge_id"])
    direct_vm.warp(datetime.fromtimestamp(resolved["recovery_not_before"] + 1, tz=timezone.utc).isoformat())
    direct_vm.sender = CHALLENGER
    contract.execute_wallet_recovery(challenge["challenge_id"])
    assert contract.lookup_by_platform("github", "alice")["owner_address"] == CHALLENGER


def test_v2_handle_only_migration_is_stale_and_reverification_restores_eligibility(direct_vm, direct_deploy, monkeypatch):
    legacy_address = "0x" + "99" * 20
    contract = direct_deploy(CONTRACT, ADMIN, legacy_address, sdk_version=os.environ.get("GENVM_VERSION", "v0.2.16"))
    module = sys.modules[contract._instance.__class__.__module__]

    class LegacyView:
        def view(self):
            return self

        def get_identity(self, address):
            return {
                "found": True,
                "owner": OWNER,
                "linked_accounts": [{
                    "platform": "twitter", "username": "legacy", "profile_url": "https://x.com/legacy",
                    "proof_url": "https://x.com/legacy/status/123", "verified_at": 100,
                    "confidence_score": 82, "bot_score": 50, "reasoning": "v2 historical proof",
                    "is_active": True, "proof_status": "ACTIVE", "proof_strength": "MEDIUM", "risk_band": "medium",
                    "canonical_platform_id": "", "verification_code": "LEGACY-CODE", "pending_id": "LEGACY-ID",
                }],
                "reputation_score": 82, "verification_count": 1, "is_flagged": False, "flag_reason": "",
            }

    monkeypatch.setattr(module.gl, "get_contract_at", lambda address: LegacyView())
    direct_vm.sender = ADMIN
    contract.migrate_legacy_identity(OWNER)
    migrated = contract.get_identity(OWNER)
    assert migrated["linked_accounts"][0]["proof_status"] == "STALE"
    assert migrated["linked_accounts"][0]["canonical_platform_id"] == ""
    assert migrated["eligible"] is False
    assert contract.is_platform_taken("twitter", "legacy") is True

    direct_vm.clear_mocks()
    direct_vm.sender = OWNER
    direct_vm.mock_web(
        r".*publish\.twitter\.com/oembed.*",
        {"status": 200, "body": json.dumps({
            "author_url": "https://x.com/legacy", "provider_url": "https://x.com",
            "html": "LEGACY-CODE", "url": "https://x.com/legacy/status/123",
        })},
    )
    proof_llm(direct_vm, canonical_id="")
    contract.reverify_platform("twitter", "legacy", "https://x.com/legacy/status/123")
    refreshed = contract.get_identity(OWNER)
    assert refreshed["linked_accounts"][0]["proof_status"] == "ACTIVE"
    assert refreshed["linked_accounts"][0]["confidence_score"] == 82
    assert refreshed["eligible"] is True
