"""Deploy and record only evidence that was actually finalized on Studionet.

This script deliberately stops when the external-evidence inputs needed for a
successful proof are absent. It never turns ACCEPTED into a success claim.
The CLI uses its configured keystore; no private key is read or printed here.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
CLI = ROOT / "node_modules" / ".bin" / ("genlayer.cmd" if os.name == "nt" else "genlayer")
FINALIZER = ROOT / "scripts" / "finalized_tx.mjs"
CODE_READER = ROOT / "scripts" / "contract_code.mjs"
VIEW_READER = ROOT / "scripts" / "live_read.mjs"
SDK_SUBMITTER = ROOT / "scripts" / "live_submit.mjs"
LIVE_DIR = ROOT / "artifacts" / "live"
OLD_CONTRACT = os.environ.get("SOULSTAMP_LEGACY_CONTRACT", "0x3108dafFCBC24E261137056c56aFCAE17677BDfB")


def load_local_release_env(path: Path = ROOT / ".env") -> None:
    """Load only ignored local release values, without overriding the process.

    CI injects its values directly. Local operators may keep the authorized
    signer and public admin address in the ignored repository-root `.env`; the
    parser intentionally accepts no other release credentials and never logs a
    value.
    """
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in ("GENLAYER_PRIVATE_KEY", "SOULSTAMP_ADMIN_ADDRESS") or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


load_local_release_env()


def run_cli(*args: str, allow_failure: bool = False) -> str:
    completed = subprocess.run([str(CLI), *args, "--rpc", RPC], cwd=ROOT, text=True, capture_output=True)
    output = (completed.stdout + "\n" + completed.stderr).strip()
    if completed.returncode and not allow_failure:
        raise RuntimeError(output)
    return output


def assert_cli_version() -> str:
    completed = subprocess.run([str(CLI), "--version"], cwd=ROOT, text=True, capture_output=True)
    version = (completed.stdout + "\n" + completed.stderr).strip()
    if completed.returncode or version != "0.39.1":
        raise RuntimeError(f"repository-local GenLayer CLI must be 0.39.1, got: {version}")
    return version


def submit(operation: str, *args: str) -> str:
    """Submit without exposing a private key in argv or logs.

    CI can provide GENLAYER_PRIVATE_KEY as a masked environment secret. Local
    operators may instead use the CLI's OS-keychain account. Both paths are
    pinned to the repository-local CLI/SDK dependency set and are finalized by
    this script before any result is recorded.
    """
    if os.environ.get("GENLAYER_PRIVATE_KEY"):
        completed = subprocess.run(
            ["node", str(SDK_SUBMITTER), operation, *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        output = (completed.stdout + "\n" + completed.stderr).strip()
        if completed.returncode:
            raise RuntimeError(output)
        return output
    return run_cli(operation, *args, allow_failure=False)


def extract_hash(output: str) -> str:
    hashes = re.findall(r"0x[0-9a-fA-F]{64}", output)
    if not hashes:
        raise RuntimeError(f"No transaction hash in CLI output:\n{output}")
    return hashes[-1]


def extract_address(output: str) -> str:
    matches = re.findall(r"0x[0-9a-fA-F]{40}", output)
    if not matches:
        raise RuntimeError(f"No contract address in CLI output:\n{output}")
    return matches[-1]


def finalize(tx_hash: str, expect_success: bool = True) -> dict:
    completed = subprocess.run(["node", str(FINALIZER), tx_hash, RPC], cwd=ROOT, text=True, capture_output=True)
    output = completed.stdout.strip().splitlines()
    if not output:
        raise RuntimeError(completed.stderr or "finality inspector returned no result")
    evidence = json.loads(output[-1])
    if evidence.get("statusName") not in ("FINALIZED", 5):
        raise RuntimeError(f"Transaction {tx_hash} was not FINALIZED: {evidence}")
    execution = evidence.get("txExecutionResultName")
    succeeded = execution in ("FINISHED_WITH_RETURN", 1)
    if expect_success and not succeeded:
        raise RuntimeError(f"Transaction {tx_hash} finalized with failed execution: {evidence}")
    if not expect_success and (succeeded or execution in (None, "NOT_VOTED", 0)):
        raise RuntimeError(f"Transaction {tx_hash} did not provide a finalized failed execution: {evidence}")
    return evidence


def write(contract: str, method: str, args: list[str], expect_success: bool = True) -> tuple[str, dict]:
    if os.environ.get("GENLAYER_PRIVATE_KEY"):
        output = submit("write", contract, method, json.dumps(args))
    else:
        output = submit("write", contract, method, "--args", *args)
    tx_hash = extract_hash(output)
    return tx_hash, finalize(tx_hash, expect_success=expect_success)


def read_view(contract: str, method: str, args: list[object]) -> object:
    completed = subprocess.run(
        ["node", str(VIEW_READER), contract, method, json.dumps(args)],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if completed.returncode:
        raise RuntimeError(completed.stderr or f"Unable to read {method}")
    lines = completed.stdout.strip().splitlines()
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


def verify_view(contract: str, specification: dict) -> dict:
    method = str(specification["method"])
    args = list(specification.get("args", []))
    assertions = specification.get("assertions")
    if not isinstance(assertions, list) or not assertions:
        raise RuntimeError(f"State verification for {method} requires non-empty assertions")
    result = read_view(contract, method, args)
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


def main() -> int:
    cli_version = assert_cli_version()
    admin = os.environ.get("SOULSTAMP_ADMIN_ADDRESS")
    if not admin:
        raise RuntimeError("Set SOULSTAMP_ADMIN_ADDRESS before the live deployment; the script will not guess an admin.")
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", admin):
        raise RuntimeError("SOULSTAMP_ADMIN_ADDRESS must be a 0x-prefixed 20-byte address")

    if os.environ.get("GENLAYER_PRIVATE_KEY"):
        deploy_output = submit("deploy", "contracts/soul_stamp.py", admin, OLD_CONTRACT)
    else:
        deploy_output = submit("deploy", "--contract", "contracts/soul_stamp.py", "--args", admin, OLD_CONTRACT)
    deploy_tx = extract_hash(deploy_output)
    deploy_finality = finalize(deploy_tx)
    contract_address = deploy_finality.get("contractAddress") or extract_address(deploy_output)

    remote_source = subprocess.run(["node", str(CODE_READER), contract_address, RPC], cwd=ROOT, text=True, capture_output=True)
    if remote_source.returncode:
        raise RuntimeError(remote_source.stderr or "Unable to read deployed source")
    local_source = (ROOT / "contracts" / "soul_stamp.py").read_text(encoding="utf-8")
    if remote_source.stdout != local_source:
        raise RuntimeError("Exact source parity check failed; deployment is not recorded as valid.")

    proof = {
        "protocol": "SoulStamp v3 identity continuity",
        "network": {"name": "Studionet", "chain_id": 61999, "rpc": RPC},
        "cli_version": cli_version,
        "contract_address": contract_address,
        "deployment_transaction": {"hash": deploy_tx, **deploy_finality},
        "source_sha256": __import__("hashlib").sha256(local_source.encode()).hexdigest(),
        "source_parity": "exact",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "explorer": f"https://genlayer-explorer.vercel.app/address/{contract_address}",
        "legacy_contract_address": OLD_CONTRACT,
        "lifecycle": [],
        "negative_lifecycle": [],
    }

    # Prove that the deployed contract rejects an unauthorized/nonexistent
    # recovery transition. This is intentionally a real signed transaction;
    # the finality inspector records the failed execution rather than hiding
    # it behind an ACCEPTED receipt.
    negative_id = "0" * 24
    negative_hash, negative_finality = write(
        contract_address,
        "execute_wallet_recovery",
        [negative_id],
        expect_success=False,
    )
    proof["negative_lifecycle"].append({
        "method": "execute_wallet_recovery",
        "args": [negative_id],
        "expected_success": False,
        "transaction": {"hash": negative_hash, **negative_finality},
    })

    # A deployment plus source parity is safe to automate. Full positive
    # challenge/recovery requires real fresh social evidence; run the explicit
    # phase below only when the operator supplies it and accepts the proof.
    lifecycle_plan = os.environ.get("SOULSTAMP_LIVE_LIFECYCLE_JSON")
    if lifecycle_plan:
        plan = json.loads(lifecycle_plan)
        if not isinstance(plan, list):
            raise RuntimeError("SOULSTAMP_LIVE_LIFECYCLE_JSON must be a JSON list")
        for item in plan:
            method = str(item["method"])
            args = [str(value) for value in item.get("args", [])]
            expect_success = bool(item.get("expect_success", True))
            tx_hash, finality = write(contract_address, method, args, expect_success=expect_success)
            entry = {"method": method, "args": args, "expected_success": expect_success, "transaction": {"hash": tx_hash, **finality}}
            if expect_success:
                verify_spec = item.get("verify")
                if not isinstance(verify_spec, dict):
                    raise RuntimeError(f"Successful lifecycle step {method} requires a post-state verify specification")
                entry["state_verification"] = verify_view(contract_address, verify_spec)
            proof["lifecycle"].append(entry)

    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    (LIVE_DIR / "studionet-v3-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"contract_address": contract_address, "deployment_tx": deploy_tx, "source_parity": "exact", "lifecycle_steps": len(proof["lifecycle"]), "negative_lifecycle_steps": len(proof["negative_lifecycle"])}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"LIVE PROOF BLOCKED: {error}", file=sys.stderr)
        raise SystemExit(1)
