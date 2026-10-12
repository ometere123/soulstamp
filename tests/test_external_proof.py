from pathlib import Path
import sys

import pytest

from scripts.verify_external_studionet_proof import canonical_source, load_plan, parse_args, run_node, source_sha256


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


def test_contract_source_is_ascii_safe_for_rpc_source_parity():
    source = Path("contracts/soul_stamp.py").read_text(encoding="utf-8")
    assert source.isascii()


def test_external_source_parity_normalizes_rpc_line_endings():
    source = "line one\nline two\n"
    assert canonical_source(source.replace("\n", "\r\n")) == source
    assert source_sha256(source.replace("\n", "\r\n")) == source_sha256(source)


def test_deployment_only_mode_does_not_require_a_lifecycle_plan(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "verify_external_studionet_proof.py",
            "--contract",
            "0x" + "1" * 40,
            "--deployment-tx",
            "0x" + "2" * 64,
            "--deployment-only",
        ],
    )
    args = parse_args()
    assert args.deployment_only is True
    assert args.plan_file is None


def test_external_source_reader_preserves_trailing_newline(tmp_path: Path):
    script = tmp_path / "emit.mjs"
    script.write_text("process.stdout.write('source\\n')\n", encoding="utf-8")
    assert run_node(script) == "source\n"
