"""
SoulStamp test suite using genlayer-test (pytest-based).
Run: genlayer test tests/
"""
import pytest
from genlayer.test import ContractRunner

CONTRACT_PATH = "contracts/soul_stamp.py"


@pytest.fixture
def runner():
    r = ContractRunner(CONTRACT_PATH)
    r.deploy(sender="0xADMIN000000000000000000000000000000000001")
    return r


# ── Deployment ────────────────────────────────────────────────────────────────

def test_deploy_sets_admin(runner):
    stats = runner.call_view("get_stats")
    assert stats["admin"] == "0xADMIN000000000000000000000000000000000001"
    assert stats["total_identities"] == 0
    assert stats["total_verifications"] == 0


# ── request_verification ─────────────────────────────────────────────────────

def test_request_verification_stores_pending(runner):
    runner.call_write(
        "request_verification",
        ["github", "octocat", "https://github.com/octocat"],
        sender="0xUSER000000000000000000000000000000000001",
    )
    pending = runner.call_view(
        "get_pending_verification",
        ["0xUSER000000000000000000000000000000000001"],
    )
    assert pending["found"] is True
    assert pending["platform"] == "github"
    assert pending["username"] == "octocat"
    assert "SOULSTAMP-VERIFY-" in pending["verification_code"]
    assert pending["pending_id"]
    assert pending["expires_at"] == 0


def test_contract_does_not_use_wall_clock_time():
    with open(CONTRACT_PATH, "r", encoding="utf-8") as f:
        source = f.read()
    assert "datetime.now" not in source
    assert "timezone" not in source


def test_request_verification_rejects_unsupported_platform(runner):
    with pytest.raises(Exception, match="Unsupported platform"):
        runner.call_write(
            "request_verification",
            ["tiktok", "user123", "https://tiktok.com/@user123"],
            sender="0xUSER000000000000000000000000000000000001",
        )


def test_request_verification_normalizes_x_to_twitter(runner):
    runner.call_write(
        "request_verification",
        ["x", "elonmusk", "https://twitter.com/elonmusk"],
        sender="0xUSER000000000000000000000000000000000002",
    )
    pending = runner.call_view(
        "get_pending_verification",
        ["0xUSER000000000000000000000000000000000002"],
    )
    assert pending["platform"] == "twitter"


def test_request_verification_allows_pending_before_completion(runner):
    """Pending proofs do not reserve a social account until GenLayer accepts them."""
    # Simulate first wallet already having the platform link in platform_to_address
    # We test this by having wallet 1 complete verification (mocked) then wallet 2 tries
    runner.call_write(
        "request_verification",
        ["github", "shared_user", "https://github.com/shared_user"],
        sender="0xUSER000000000000000000000000000000000001",
    )
    # Wallet 2 tries the same account — should fail
    runner.call_write(
        "request_verification",
        ["github", "shared_user", "https://github.com/shared_user"],
        sender="0xUSER000000000000000000000000000000000002",
    )


def test_cancel_pending_verification(runner):
    runner.call_write(
        "request_verification",
        ["github", "octocat", "https://github.com/octocat"],
        sender="0xUSER000000000000000000000000000000000001",
    )
    runner.call_write(
        "cancel_pending_verification",
        [],
        sender="0xUSER000000000000000000000000000000000001",
    )
    pending = runner.call_view(
        "get_pending_verification",
        ["0xUSER000000000000000000000000000000000001"],
    )
    assert pending["found"] is False


def test_cancel_without_pending_raises(runner):
    with pytest.raises(Exception, match="No pending verification"):
        runner.call_write(
            "cancel_pending_verification",
            [],
            sender="0xUSER000000000000000000000000000000000001",
        )


# ── complete_verification (uses mock LLM responses) ───────────────────────────

def test_complete_verification_without_pending_raises(runner):
    with pytest.raises(Exception, match="No pending verification"):
        runner.call_write(
            "complete_verification",
            [],
            sender="0xUSER000000000000000000000000000000000001",
        )


def test_contract_has_structured_proof_health_consensus():
    with open(CONTRACT_PATH, "r", encoding="utf-8") as f:
        source = f.read()
    for field in [
        "code_found",
        "account_match",
        "proof_strength",
        "risk_band",
        "confidence_bucket",
        "reason_code",
        "proof_status",
    ]:
        assert field in source
    assert "run_nondet_unsafe" in source
    assert "reverify_platform" in source
    for status in ["ACTIVE", "STALE", "REVOKED", "CONFLICTED", "FLAGGED"]:
        assert status in source


def test_contract_restricts_fetch_sources():
    with open(CONTRACT_PATH, "r", encoding="utf-8") as f:
        source = f.read()
    assert "api.github.com/users" in source
    assert "publish.twitter.com/oembed" in source
    assert "Discord attestation URL is not from the configured backend" in source
    assert "used_discord_attestations" in source


# ── get_identity ──────────────────────────────────────────────────────────────

def test_get_identity_not_found(runner):
    result = runner.call_view("get_identity", ["0xNOBODY0000000000000000000000000000000001"])
    assert result["found"] is False


# ── lookup_by_platform ────────────────────────────────────────────────────────

def test_lookup_by_platform_not_found(runner):
    result = runner.call_view("lookup_by_platform", ["github", "nobody"])
    assert result["found"] is False


def test_is_platform_taken_false(runner):
    assert runner.call_view("is_platform_taken", ["github", "octocat"]) is False


# ── revoke_platform ───────────────────────────────────────────────────────────

def test_revoke_without_identity_raises(runner):
    with pytest.raises(Exception, match="No verified link"):
        runner.call_write(
            "revoke_platform",
            ["github", "octocat"],
            sender="0xUSER000000000000000000000000000000000001",
        )


# ── Admin functions ───────────────────────────────────────────────────────────

def test_non_admin_cannot_flag(runner):
    with pytest.raises(Exception, match="Only the admin"):
        runner.call_write(
            "flag_identity",
            ["0xSOMEONE000000000000000000000000000000001", "suspicious"],
            sender="0xUSER000000000000000000000000000000000001",
        )


def test_admin_can_transfer_role(runner):
    runner.call_write(
        "transfer_admin",
        ["0xNEWADMIN00000000000000000000000000000001"],
        sender="0xADMIN000000000000000000000000000000000001",
    )
    stats = runner.call_view("get_stats")
    assert stats["admin"] == "0xNEWADMIN00000000000000000000000000000001"


def test_old_admin_cannot_act_after_transfer(runner):
    runner.call_write(
        "transfer_admin",
        ["0xNEWADMIN00000000000000000000000000000001"],
        sender="0xADMIN000000000000000000000000000000000001",
    )
    with pytest.raises(Exception, match="Only the admin"):
        runner.call_write(
            "flag_identity",
            ["0xSOMEONE000000000000000000000000000000001", "bad actor"],
            sender="0xADMIN000000000000000000000000000000000001",
        )


# ── Pagination ────────────────────────────────────────────────────────────────

def test_get_all_addresses_empty(runner):
    result = runner.call_view("get_all_addresses", [0, 10])
    assert isinstance(result, list)
    assert len(result) == 0


# ── Audit log ─────────────────────────────────────────────────────────────────

def test_audit_log_empty_for_unknown(runner):
    result = runner.call_view("get_audit_log", ["0xNOBODY0000000000000000000000000000000001"])
    assert result == []
