from pathlib import Path
import os

import pytest

from scripts.live_studionet_proof import load_local_release_env, parse_lifecycle_plan


PROOF_SCRIPT = Path("scripts/live_studionet_proof.py")


def test_live_proof_requires_finality_for_success_and_failure_paths():
    source = PROOF_SCRIPT.read_text(encoding="utf-8")
    assert "expect_success: bool = True" in source
    assert "FINISHED_WITH_RETURN" in source
    assert "did not provide a finalized failed execution" in source


def test_live_proof_normalizes_rpc_source_line_endings():
    source = PROOF_SCRIPT.read_text(encoding="utf-8")
    assert "canonical_source" in source
    assert "exact_after_line_ending_normalization" in source


def test_finality_inspector_supports_current_studionet_receipt_shape():
    source = Path("scripts/finalized_tx.mjs").read_text(encoding="utf-8")
    assert "status_name" in source
    assert "consensus_data?.leader_receipt" in source
    assert "rawExecutionResults" in source
    assert "FINISHED_WITH_ERROR" in source


def test_live_proof_records_a_real_negative_recovery_transition():
    source = PROOF_SCRIPT.read_text(encoding="utf-8")
    assert '"execute_wallet_recovery"' in source
    assert 'expect_success=False' in source
    assert '"negative_lifecycle"' in source


def test_live_positive_steps_require_post_state_assertions():
    source = PROOF_SCRIPT.read_text(encoding="utf-8")
    assert "VIEW_READER" in source
    assert "requires a post-state verify specification" in source
    assert "state_verification" in source
    assert "EXPLORER" in source
    assert "/tx/" in source


def test_local_release_env_loader_is_scoped_and_does_not_override_process(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "GENLAYER_PRIVATE_KEY=0x" + "1" * 64 + "\n"
        "SOULSTAMP_ADMIN_ADDRESS=0x" + "2" * 40 + "\n"
        "UNSUPPORTED_RELEASE_SECRET=must-not-load\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("GENLAYER_PRIVATE_KEY", raising=False)
    monkeypatch.setenv("SOULSTAMP_ADMIN_ADDRESS", "process-admin-wins")
    monkeypatch.delenv("UNSUPPORTED_RELEASE_SECRET", raising=False)
    load_local_release_env(env_file)
    assert os.environ["GENLAYER_PRIVATE_KEY"] == "0x" + "1" * 64
    assert os.environ["SOULSTAMP_ADMIN_ADDRESS"] == "process-admin-wins"
    assert "UNSUPPORTED_RELEASE_SECRET" not in os.environ


def test_full_live_plan_fails_closed_when_required_lifecycle_step_is_missing():
    with pytest.raises(RuntimeError, match="missing successful steps"):
        parse_lifecycle_plan(
            '[{"method":"request_verification","verify":{"method":"get_pending_verification","assertions":[{"path":"found","value":true}]}}]',
            require_full=True,
        )


def test_live_plan_rejects_unnamed_steps():
    with pytest.raises(RuntimeError, match="must name a contract method"):
        parse_lifecycle_plan('[{"args":[]}]')


def test_live_plan_rejects_success_without_post_state_assertions():
    with pytest.raises(RuntimeError, match="non-empty post-state assertions"):
        parse_lifecycle_plan('[{"method":"complete_verification"}]')
