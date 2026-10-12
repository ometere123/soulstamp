from pathlib import Path

import pytest

from scripts.verify_external_studionet_proof import load_plan


def plan_item(method: str, number: int, *, expect_success: bool = True) -> dict:
    item = {"method": method, "tx": "0x" + f"{number:064x}"}
    if not expect_success:
        item["expect_success"] = False
    if expect_success:
        item["verify"] = {
            "method": "get_stats",
            "assertions": [{"path": "verifier_version", "value": "soulstamp-v3.0-continuity"}],
        }
    return item


def test_external_plan_requires_all_successful_protocol_steps(tmp_path: Path):
    plan_file = tmp_path / "plan.json"
    plan_file.write_text('[{"method":"request_verification","tx":"0x' + "1" * 64 + '","verify":{"method":"get_stats","assertions":[{"path":"verifier_version","value":"soulstamp-v3.0-continuity"}]}}]', encoding="utf-8")
    with pytest.raises(RuntimeError, match="missing successful steps"):
        load_plan(plan_file)


def test_external_plan_accepts_success_and_finalized_negative_evidence(tmp_path: Path):
    methods = [
        "request_verification",
        "complete_verification",
        "request_ownership_challenge",
        "submit_challenge_evidence",
        "respond_to_challenge",
        "resolve_ownership_challenge",
        "execute_wallet_recovery",
        "revoke_platform",
    ]
    plan_file = tmp_path / "plan.json"
    plan_file.write_text(
        __import__("json").dumps([plan_item(method, index + 1) for index, method in enumerate(methods)] + [plan_item("execute_wallet_recovery", 99, expect_success=False)]),
        encoding="utf-8",
    )
    plan = load_plan(plan_file)
    assert len(plan) == 9
    assert plan[-1]["expect_success"] is False


def test_external_verifier_has_no_signing_path():
    source = Path("scripts/verify_external_studionet_proof.py").read_text(encoding="utf-8")
    assert "private key" in source.lower()
    assert "GENLAYER_PRIVATE_KEY" not in source
    assert "SOULSTAMP_ADMIN_PRIVATE_KEY" not in source
    assert "subprocess.run" in source
    assert "os.environ" not in source
