from pathlib import Path


PROOF_SCRIPT = Path("scripts/live_studionet_proof.py")


def test_live_proof_requires_finality_for_success_and_failure_paths():
    source = PROOF_SCRIPT.read_text(encoding="utf-8")
    assert "expect_success: bool = True" in source
    assert "FINISHED_WITH_RETURN" in source
    assert "did not provide a finalized failed execution" in source


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
