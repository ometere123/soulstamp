import json
import os
import re
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


def proof_llm(vm, *, account_match=True, canonical_id="42", decision=None):
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
            "reason_code": "CODE_FOUND_ON_CANONICAL_PROFILE" if account_match else "ACCOUNT_MISMATCH",
            "reasoning": "direct-mode evidence fixture",
        }),
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


def test_x_requires_provider_author_id_not_handle_fallback(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.request_verification("twitter", "claimed", "https://x.com/claimed/status/123456")
    pending = contract.get_pending_verification(OWNER)
    direct_vm.mock_web(
        r".*publish\.twitter\.com/oembed.*",
        {"status": 200, "body": json.dumps({
            "author_url": "https://x.com/claimed",
            "html": f"<p>{pending['verification_code']}</p>",
        })},
    )
    proof_llm(direct_vm, account_match=False, canonical_id="")
    with direct_vm.expect_revert("ownership"):
        contract.complete_verification("https://x.com/claimed/status/123456")


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


def test_expired_proof_cannot_be_challenged(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    verify_github(direct_vm, contract, OWNER, "alice", "42")
    account = contract.get_identity(OWNER)["linked_accounts"][0]
    expires_at = account["dossier"]["evidence_expires_at"]
    direct_vm.warp(datetime.fromtimestamp(expires_at + 1, tz=timezone.utc).isoformat())
    direct_vm.sender = CHALLENGER
    with direct_vm.expect_revert("fresh active proof"):
        contract.request_ownership_challenge("github", "alice")


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
    direct_vm.warp(datetime.fromtimestamp(challenge["rebuttal_deadline"] + 1, tz=timezone.utc).isoformat())
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
    github_web(direct_vm, "alice", challenge["challenger_code"], canonical_id="42")
    proof_llm(direct_vm, canonical_id="42")
    contract.submit_challenge_evidence(challenge["challenge_id"], "https://github.com/alice")
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
    attestation_url = "https://attest.example/api/discord/attestations/token-1"
    body = {
        "discord_user_id": "123", "wallet": OWNER,
        "verification_code": pending["verification_code"],
        "claimed_username": "alice#123", "pending_id": pending["pending_id"],
        "issued_at": 1893455990, "expires_at": 1893456300,
    }
    direct_vm.mock_web(r".*attest\.example/api/discord/attestations/token-1$", {"status": 200, "body": json.dumps(body)})
    proof_llm(direct_vm, canonical_id="123")
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
    attestation_url = "https://attest.example/api/discord/attestations/token-expired"
    body = {
        "discord_user_id": "123", "wallet": OTHER,
        "verification_code": pending["verification_code"],
        "claimed_username": "expired#123", "pending_id": pending["pending_id"],
        "issued_at": 1893455000, "expires_at": 1893455999,
    }
    direct_vm.mock_web(r".*attest\.example/api/discord/attestations/token-expired$", {"status": 200, "body": json.dumps(body)})
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
        r"https://github\.com/alice$",
        {"status": 200, "body": json.dumps({"bio": challenge["challenger_code"], "login": "alice", "id": 42})},
    )
    with direct_vm.expect_revert("Wait for the rebuttal deadline"):
        contract.resolve_ownership_challenge(challenge["challenge_id"])
    deadline_time = datetime.fromtimestamp(challenge["rebuttal_deadline"] + 1, tz=timezone.utc)
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
        r"https://github\.com/alice$",
        {"status": 200, "body": json.dumps({"bio": challenge["owner_rebuttal_code"], "login": "alice", "id": 42})},
    )
    proof_llm(direct_vm, decision="CHALLENGER_UPHOLDS")
    contract.resolve_ownership_challenge(challenge_id)
    assert contract.get_challenge(challenge_id)["status"] == "RESOLVED_INCONCLUSIVE"


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
        r"https://github\.com/alice$",
        {"status": 200, "body": json.dumps({"bio": challenge["challenger_code"], "login": "alice", "id": 42})},
    )
    direct_vm.warp(datetime.fromtimestamp(challenge["rebuttal_deadline"] + 1, tz=timezone.utc).isoformat())
    proof_llm(direct_vm, decision="CHALLENGER_UPHOLDS")
    contract.resolve_ownership_challenge(challenge["challenge_id"])
    resolved = contract.get_challenge(challenge["challenge_id"])
    direct_vm.warp(datetime.fromtimestamp(resolved["recovery_not_before"] + 1, tz=timezone.utc).isoformat())
    direct_vm.sender = CHALLENGER
    contract.execute_wallet_recovery(challenge["challenge_id"])

    bob_after = contract.lookup_by_platform("github", "bob")
    assert bob_after["owner_address"] == CHALLENGER
    assert bob_after["proof_status"] == "STALE"
    assert contract.is_platform_taken("github", "bob") is True


def test_discord_challenge_attestation_is_consumed_once(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = ADMIN
    contract.set_discord_attestation_base_url("https://attest.example")
    direct_vm.warp("2030-01-01T00:00:00Z")
    direct_vm.sender = OWNER
    contract.request_verification("discord", "alice#123", "https://discord.com/users/123")
    pending = contract.get_pending_verification(OWNER)
    verification_url = "https://attest.example/api/discord/attestations/verify-token"
    verification_body = {
        "discord_user_id": "123", "wallet": OWNER,
        "verification_code": pending["verification_code"],
        "claimed_username": "alice#123", "pending_id": pending["pending_id"],
        "issued_at": 1893455990, "expires_at": 1893456300,
    }
    direct_vm.mock_web(r".*attest\.example/api/discord/attestations/verify-token$", {"status": 200, "body": json.dumps(verification_body)})
    proof_llm(direct_vm, canonical_id="123")
    contract.complete_verification(verification_url)
    direct_vm.clear_mocks()
    direct_vm.sender = CHALLENGER
    contract.request_ownership_challenge("discord", "alice#123")
    challenge = contract.get_challenges(CHALLENGER, 0, 10)[0]
    challenge_url = "https://attest.example/api/discord/attestations/challenge-token"
    challenge_body = {
        "discord_user_id": "123", "wallet": CHALLENGER,
        "verification_code": challenge["challenger_code"],
        "claimed_username": "alice#123", "pending_id": challenge["challenge_id"],
        "issued_at": 1893455990, "expires_at": 1893456300,
    }
    direct_vm.mock_web(r".*attest\.example/api/discord/attestations/challenge-token$", {"status": 200, "body": json.dumps(challenge_body)})
    proof_llm(direct_vm, canonical_id="123")
    contract.submit_challenge_evidence(challenge["challenge_id"], challenge_url)
    direct_vm.sender = OWNER
    with direct_vm.expect_revert("already been used"):
        contract.respond_to_challenge(challenge["challenge_id"], challenge_url, "The current owner retains this account.")
