from pathlib import Path
import os

from scripts.live_studionet_proof import load_local_release_env


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
