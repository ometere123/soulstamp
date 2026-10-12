"""Verify a user-deployed SoulStamp lifecycle using public Studionet data only.

This script never signs, deploys, reads a private key, or treats ACCEPTED as
success. It is the safe handoff path when the operator performs deployment and
manual social-evidence testing outside this workspace.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
EXPLORER = "https://explorer-studio.genlayer.com"
FINALIZER = ROOT / "scripts" / "finalized_tx.mjs"
CODE_READER = ROOT / "scripts" / "contract_code.mjs"
VIEW_READER = ROOT / "scripts" / "live_read.mjs"
SOURCE = ROOT / "contracts" / "soul_stamp.py"
TX_RE = re.compile(r"0x[0-9a-fA-F]{64}\Z")
ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{40}\Z")
REQUIRED_FULL_LIFECYCLE_METHODS = {
    "request_verification",
    "complete_verification",
    "request_ownership_challenge",
    "submit_challenge_evidence",
    "respond_to_challenge",
    "resolve_ownership_challenge",
    "execute_wallet_recovery",
    "revoke_platform",
}


def canonical_source(source: str) -> str:
    """Compare source content independently of RPC line-ending transport."""
    return source.replace("\r\n", "\n").replace("\r", "\n")


def source_sha256(source: str) -> str:
    return hashlib.sha256(canonical_source(source).encode("utf-8")).hexdigest()


def validate_hex(value: str, pattern: re.Pattern[str], label: str) -> str:
    if not pattern.fullmatch(value):
        raise RuntimeError(f"{label} must be a valid 0x-prefixed value")
    return value


def run_node(script: Path, *args: str) -> str:
    completed = subprocess.run(
        ["node", str(script), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if completed.returncode:
        raise RuntimeError(completed.stderr.strip() or f"{script.name} failed")
    return completed.stdout.strip()


def finalized_transaction(tx_hash: str, rpc: str, expect_success: bool = True) -> dict:
    output = run_node(FINALIZER, tx_hash, rpc)
    lines = output.splitlines()
    if not lines:
        raise RuntimeError(f"No finality result returned for {tx_hash}")
    evidence = json.loads(lines[-1])
    if evidence.get("statusName") not in ("FINALIZED", 5):
        raise RuntimeError(f"Transaction {tx_hash} was not FINALIZED: {evidence}")
    execution = evidence.get("txExecutionResultName")
    succeeded = execution in ("FINISHED_WITH_RETURN", 1)
    if expect_success and not succeeded:
        raise RuntimeError(f"Transaction {tx_hash} finalized with failed execution: {evidence}")
    if not expect_success and (succeeded or execution in (None, "NOT_VOTED", 0)):
        raise RuntimeError(f"Transaction {tx_hash} did not finalize as a failed execution: {evidence}")
    return evidence


def transaction_record(tx_hash: str, finality: dict) -> dict:
    return {"hash": tx_hash, "explorer": f"{EXPLORER}/tx/{tx_hash}", **finality}


def read_view(contract: str, method: str, args: list[object], rpc: str) -> object:
    output = run_node(VIEW_READER, contract, method, json.dumps(args), rpc)
    lines = output.splitlines()
    if not lines:
        raise RuntimeError(f"View {method} returned no JSON")
    return json.loads(lines[-1])


def value_at_path(value: object, path: str) -> object:
    current = value
    for part in path.split(".") if path else []:
        if isinstance(current, list):
            current = current[int(part)]
        elif isinstance(current, dict):
            current = current[part]
        else:
            raise KeyError(path)
    return current


def verify_view(contract: str, specification: dict, rpc: str) -> dict:
    method = str(specification.get("method", "")).strip()
    assertions = specification.get("assertions")
    if not method or not isinstance(assertions, list) or not assertions:
        raise RuntimeError("Every lifecycle state check requires a method and non-empty assertions")
    args = list(specification.get("args", []))
    result = read_view(contract, method, args, rpc)
    checked = []
    for assertion in assertions:
        if not isinstance(assertion, dict) or "path" not in assertion or "value" not in assertion:
            raise RuntimeError(f"Invalid state assertion for {method}: {assertion!r}")
        path = str(assertion["path"])
        try:
            actual = value_at_path(result, path)
        except (KeyError, IndexError, ValueError, TypeError) as error:
            raise RuntimeError(f"State assertion path {path!r} was not present in {method}: {error}") from error
        expected = assertion["value"]
        if actual != expected:
            raise RuntimeError(f"State assertion failed for {method}.{path}: expected {expected!r}, got {actual!r}")
        checked.append({"path": path, "expected": expected, "actual": actual})
    return {"method": method, "args": args, "result": result, "assertions": checked}


def load_plan(path: Path, require_full: bool = True) -> list[dict]:
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise RuntimeError(f"Unable to read lifecycle plan {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Lifecycle plan is not valid JSON: {error}") from error
    if not isinstance(plan, list):
        raise RuntimeError("Lifecycle plan must be a JSON list")
    successful_methods = set()
    for item in plan:
        if not isinstance(item, dict):
            raise RuntimeError("Every lifecycle plan item must be an object")
        method = str(item.get("method", "")).strip()
        tx_hash = str(item.get("tx", "")).strip()
        if not method:
            raise RuntimeError("Every lifecycle plan item must name a contract method")
        validate_hex(tx_hash, TX_RE, f"Transaction hash for {method}")
        if bool(item.get("expect_success", True)):
            verify = item.get("verify")
            if not isinstance(verify, dict) or not isinstance(verify.get("assertions"), list) or not verify["assertions"]:
                raise RuntimeError(f"Successful lifecycle step {method} requires non-empty post-state assertions")
            successful_methods.add(method)
    if require_full:
        missing = sorted(REQUIRED_FULL_LIFECYCLE_METHODS - successful_methods)
        if missing:
            raise RuntimeError("Full external lifecycle proof is missing successful steps: " + ", ".join(missing))
    return plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", required=True, help="deployed SoulStamp contract address")
    parser.add_argument("--deployment-tx", required=True, help="finalized deployment transaction hash")
    parser.add_argument("--plan-file", required=True, type=Path, help="JSON file containing public lifecycle tx hashes")
    parser.add_argument(
        "--artifact",
        type=Path,
        default=ROOT / "artifacts" / "live" / "studionet-v3-external-proof.json",
        help="where to write the verified public evidence artifact",
    )
    parser.add_argument("--rpc", default=RPC, help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.rpc != RPC:
        raise RuntimeError("External proof verification is restricted to Studionet 61999")
    contract = validate_hex(args.contract, ADDRESS_RE, "Contract address")
    deployment_tx = validate_hex(args.deployment_tx, TX_RE, "Deployment transaction")
    plan = load_plan(args.plan_file)

    deployment_finality = finalized_transaction(deployment_tx, args.rpc)
    returned_contract = deployment_finality.get("contractAddress")
    if returned_contract and str(returned_contract).lower() != contract.lower():
        raise RuntimeError(
            f"Deployment receipt contract address {returned_contract} does not match supplied {contract}"
        )

    remote_source = run_node(CODE_READER, contract, args.rpc)
    local_source = SOURCE.read_text(encoding="utf-8")
    if canonical_source(remote_source) != canonical_source(local_source):
        raise RuntimeError("Exact source parity check failed after line-ending normalization; external deployment is not recorded as valid")

    deployed_stats = read_view(contract, "get_stats", [], args.rpc)
    if not isinstance(deployed_stats, dict) or deployed_stats.get("verifier_version") != "soulstamp-v3.0-continuity":
        raise RuntimeError("Deployed contract did not expose the expected v3 verifier state")

    lifecycle = []
    negative_lifecycle = []
    for item in plan:
        method = str(item["method"])
        tx_hash = str(item["tx"])
        expected_success = bool(item.get("expect_success", True))
        finality = finalized_transaction(tx_hash, args.rpc, expect_success=expected_success)
        entry = {
            "method": method,
            "args": list(item.get("args", [])),
            "expected_success": expected_success,
            "transaction": transaction_record(tx_hash, finality),
        }
        if isinstance(item.get("verify"), dict):
            entry["state_verification"] = verify_view(contract, item["verify"], args.rpc)
        (lifecycle if expected_success else negative_lifecycle).append(entry)

    artifact = {
        "protocol": "SoulStamp v3 identity continuity",
        "network": {"name": "Studionet", "chain_id": 61999, "rpc": args.rpc},
        "verification_mode": "external-read-only",
        "contract_address": contract,
        "deployment_transaction": transaction_record(deployment_tx, deployment_finality),
        "source_sha256": source_sha256(local_source),
        "api_source_sha256": source_sha256(remote_source),
        "source_parity": "exact_after_line_ending_normalization",
        "source_line_ending_note": "Studionet source is compared after CRLF/CR to LF normalization.",
        "deployed_state": {
            "method": "get_stats",
            "assertions": [
                {
                    "path": "verifier_version",
                    "expected": "soulstamp-v3.0-continuity",
                    "actual": deployed_stats.get("verifier_version"),
                }
            ],
            "result": deployed_stats,
        },
        "lifecycle": lifecycle,
        "negative_lifecycle": negative_lifecycle,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "explorer": f"{EXPLORER}/address/{contract}",
        "local_source_revision": subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip(),
    }
    args.artifact.parent.mkdir(parents=True, exist_ok=True)
    args.artifact.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "contract_address": contract,
                "deployment_tx": deployment_tx,
                "source_parity": "exact_after_line_ending_normalization",
                "lifecycle_steps": len(lifecycle),
                "negative_lifecycle_steps": len(negative_lifecycle),
                "artifact": str(args.artifact),
            }
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"EXTERNAL PROOF BLOCKED: {error}", file=sys.stderr)
        raise SystemExit(1)
