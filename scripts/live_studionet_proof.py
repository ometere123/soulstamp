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
SDK_SUBMITTER = ROOT / "scripts" / "live_submit.mjs"
LIVE_DIR = ROOT / "artifacts" / "live"
OLD_CONTRACT = os.environ.get("SOULSTAMP_LEGACY_CONTRACT", "0x3108dafFCBC24E261137056c56aFCAE17677BDfB")


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


def finalize(tx_hash: str) -> dict:
    completed = subprocess.run(["node", str(FINALIZER), tx_hash, RPC], cwd=ROOT, text=True, capture_output=True)
    output = completed.stdout.strip().splitlines()
    if not output:
        raise RuntimeError(completed.stderr or "finality inspector returned no result")
    evidence = json.loads(output[-1])
    if evidence.get("statusName") not in ("FINALIZED", 5):
        raise RuntimeError(f"Transaction {tx_hash} was not FINALIZED: {evidence}")
    if evidence.get("txExecutionResultName") not in ("FINISHED_WITH_RETURN", 1):
        raise RuntimeError(f"Transaction {tx_hash} finalized with failed execution: {evidence}")
    return evidence


def write(contract: str, method: str, args: list[str]) -> tuple[str, dict]:
    if os.environ.get("GENLAYER_PRIVATE_KEY"):
        output = submit("write", contract, method, json.dumps(args))
    else:
        output = submit("write", contract, method, "--args", *args)
    tx_hash = extract_hash(output)
    return tx_hash, finalize(tx_hash)


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
    }

    # A deployment plus source parity is safe to automate. Full positive
    # challenge/recovery requires real fresh social evidence; run the explicit
    # phase below only when the operator supplies it and accepts the proof.
    lifecycle_plan = os.environ.get("SOULSTAMP_LIVE_LIFECYCLE_JSON")
    if lifecycle_plan:
        plan = json.loads(lifecycle_plan)
        for item in plan:
            method = str(item["method"])
            args = [str(value) for value in item.get("args", [])]
            tx_hash, finality = write(contract_address, method, args)
            proof["lifecycle"].append({"method": method, "args": args, "transaction": {"hash": tx_hash, **finality}})

    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    (LIVE_DIR / "studionet-v3-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"contract_address": contract_address, "deployment_tx": deploy_tx, "source_parity": "exact", "lifecycle_steps": len(proof["lifecycle"])}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"LIVE PROOF BLOCKED: {error}", file=sys.stderr)
        raise SystemExit(1)
