from pathlib import Path


CONTRACT = Path("contracts/soul_stamp.py")


def test_contract_declares_v3_continuity_protocol():
    source = CONTRACT.read_text(encoding="utf-8")
    assert "# v0.3.0" in source
    assert "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" in source
    for method in (
        "request_ownership_challenge",
        "submit_challenge_evidence",
        "respond_to_challenge",
        "resolve_ownership_challenge",
        "expire_ownership_challenge",
        "execute_wallet_recovery",
        "cancel_wallet_recovery",
        "consumer_eligibility",
        "migrate_legacy_identity",
    ):
        assert f"def {method}" in source


def test_contract_has_replay_and_canonical_guards():
    source = CONTRACT.read_text(encoding="utf-8")
    assert "canonical_id_to_address" in source
    assert "used_discord_attestations" in source
    assert "author_url" in source
    assert "GENLAYER_INDEPENDENT_RESOLUTION" in source
    assert "event_hash" in source
    assert "evidence_expires_at" in source
    assert "recovery_counter_commitment" in source


def test_contract_preserves_provider_limited_x_evidence_and_safe_v2_migration():
    source = CONTRACT.read_text(encoding="utf-8")
    assert 'canonical_id = ""' in source
    assert "CODE_FOUND_ON_CANONICAL_TWEET_HANDLE_ONLY" in source
    assert "DISCORD_ATTESTATION_TOKEN_MAX_LENGTH" in source
    assert 'MIGRATED_REQUIRES_REVERIFICATION' in source
    assert 'status not in ("REVOKED", "RECOVERED")' in source


def test_confidence_policy_is_contract_deterministic_and_legacy_handles_are_imported():
    source = CONTRACT.read_text(encoding="utf-8")
    assert "def _policy_confidence" in source
    assert "if platform == \"github\":\n            return 92" in source
    assert "if platform == \"twitter\":\n            return 82" in source
    assert "if platform == \"discord\":\n            return 94" in source
    assert "confidence = self._policy_confidence(platform, code_found, account_match, fresh)" in source
    assert 'if not platform or not username or platform not in SUPPORTED_PLATFORMS:' in source
    assert 'canonical_id = str(legacy_acct.get("canonical_platform_id", "") or "")' in source
