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
        "execute_wallet_recovery",
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


def test_contract_requires_stable_x_ids_and_safe_v2_migration():
    source = CONTRACT.read_text(encoding="utf-8")
    assert 'canonical_id = f"id:{author_id}" if re.match(r"^[0-9]+$", author_id) else ""' in source
    assert 'MIGRATED_REQUIRES_REVERIFICATION' in source
    assert 'status not in ("REVOKED", "RECOVERED")' in source
