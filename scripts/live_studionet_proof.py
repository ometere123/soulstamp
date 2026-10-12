"""Deploy and record only evidence that was actually finalized on Studionet.

This script deliberately stops when the external-evidence inputs needed for a
successful proof are absent. It never turns ACCEPTED into a success claim.
The CLI uses its configured keystore; no private key is read or printed here.
"""

from __future__ import annotations

import json
import hashlib
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
EXPLORER = "https://explorer-studio.genlayer.com"
CLI = ROOT / "node_modules" / ".bin" / ("genlayer.cmd" if os.name == "nt" else "genlayer")
FINALIZER = ROOT / "scripts" / "finalized_tx.mjs"
CODE_READER = ROOT / "scripts" / "contract_code.mjs"
VIEW_READER = ROOT / "scripts" / "live_read.mjs"
SDK_SUBMITTER = ROOT / "scripts" / "live_submit.mjs"
KEY_ADDRESS_READER = ROOT / "scripts" / "key_address.mjs"
LIVE_DIR = ROOT / "artifacts" / "live"
OLD_CONTRACT = os.environ.get("SOULSTAMP_LEGACY_CONTRACT", "0x3108dafFCBC24E261137056c56aFCAE17677BDfB")
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
        if key not in ("GENLAYER_PRIVATE_KEY", "SOULSTAMP_ADMIN_PRIVATE_KEY", "SOULSTAMP_ADMIN_ADDRESS") or key in os.environ:
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


def submit(operation: str, *args: str, signer: str = "deployer") -> str:
    """Submit without exposing a private key in argv or logs.

    CI can provide GENLAYER_PRIVATE_KEY as a masked environment secret. Local
    operators may instead use the CLI's OS-keychain account. Both paths are
    pinned to the repository-local CLI/SDK dependency set and are finalized by
    this script before any result is recorded.
    """
    signer_env = {
        "deployer": "GENLAYER_PRIVATE_KEY",
        "owner": "GENLAYER_PRIVATE_KEY",
        "admin": "SOULSTAMP_ADMIN_PRIVATE_KEY",
        "challenger": "SOULSTAMP_ADMIN_PRIVATE_KEY",
    }.get(signer)
    if signer_env is None:
        raise RuntimeError(f"Unsupported live signer '{signer}'")
    selected_key = os.environ.get(signer_env)
    if signer_env != "GENLAYER_PRIVATE_KEY" and not selected_key:
        raise RuntimeError(f"{signer_env} is required for live signer '{signer}'")
    if selected_key:
        child_env = os.environ.copy()
        child_env["GENLAYER_PRIVATE_KEY"] = selected_key
        completed = subprocess.run(
            ["node", str(SDK_SUBMITTER), operation, *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
            env=child_env,
        )
        output = (completed.stdout + "\n" + completed.stderr).strip()
        if completed.returncode:
            raise RuntimeError(output)
        return output
    return run_cli(operation, *args, allow_failure=False)


def derived_signer_address(signer: str) -> str | None:
    key_name = {
        "deployer": "GENLAYER_PRIVATE_KEY",
        "owner": "GENLAYER_PRIVATE_KEY",
        "admin": "SOULSTAMP_ADMIN_PRIVATE_KEY",
        "challenger": "SOULSTAMP_ADMIN_PRIVATE_KEY",
    }.get(signer)
    if key_name is None or not os.environ.get(key_name):
        return None
    child_env = os.environ.copy()
    child_env["GENLAYER_PRIVATE_KEY"] = os.environ[key_name]
    completed = subprocess.run(["node", str(KEY_ADDRESS_READER)], cwd=ROOT, text=True, capture_output=True, env=child_env)
    if completed.returncode:
        raise RuntimeError(f"Unable to derive the {signer} signer address")
    address = completed.stdout.strip()
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", address):
        raise RuntimeError(f"Unable to derive a valid {signer} signer address")
    return address.lower()


def parse_lifecycle_plan(raw: str | None, require_full: bool = False) -> list[dict]:
    if not raw:
        if require_full:
            raise RuntimeError(
                "SOULSTAMP_LIVE_LIFECYCLE_JSON is required when full live lifecycle proof is enabled"
            )
        return []
    plan = json.loads(raw)
    if not isinstance(plan, list):
        raise RuntimeError("SOULSTAMP_LIVE_LIFECYCLE_JSON must be a JSON list")
    allowed = {"deployer", "owner", "admin", "challenger"}
    successful_methods = set()
    for item in plan:
        if not isinstance(item, dict):
            raise RuntimeError("Every live lifecycle step must be a JSON object")
        method = str(item.get("method", "")).strip()
        if not method:
            raise RuntimeError("Every live lifecycle step must name a contract method")
        signer = str(item.get("signer", "deployer"))
        if signer not in allowed:
            raise RuntimeError(f"Unsupported live signer '{signer}'")
        expected_sender = str(item.get("expect_sender", "")).strip()
        if not re.fullmatch(r"0x[0-9a-fA-F]{40}", expected_sender):
            raise RuntimeError(f"Lifecycle step {method} requires a valid expect_sender address")
        if signer in ("admin", "challenger") and not os.environ.get("SOULSTAMP_ADMIN_PRIVATE_KEY"):
            raise RuntimeError("SOULSTAMP_ADMIN_PRIVATE_KEY is required by the live lifecycle plan")
        if bool(item.get("expect_success", True)):
            verify = item.get("verify")
            if not isinstance(verify, dict) or not isinstance(verify.get("assertions"), list) or not verify["assertions"]:
                raise RuntimeError(f"Successful lifecycle step {method} requires non-empty post-state assertions")
            successful_methods.add(method)
    if require_full:
        missing = sorted(REQUIRED_FULL_LIFECYCLE_METHODS - successful_methods)
        if missing:
            raise RuntimeError(
                "Full live lifecycle proof is missing successful steps: " + ", ".join(missing)
            )
    return plan


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
    if evidence.get("rawResultName") not in ("MAJORITY_AGREE", 6):
        raise RuntimeError(f"Transaction {tx_hash} finalized without majority agreement: {evidence}")
    execution = evidence.get("txExecutionResultName")
    succeeded = execution in ("FINISHED_WITH_RETURN", 1)
    if expect_success and not succeeded:
        raise RuntimeError(f"Transaction {tx_hash} finalized with failed execution: {evidence}")
    if not expect_success and (succeeded or execution in (None, "NOT_VOTED", 0)):
        raise RuntimeError(f"Transaction {tx_hash} did not provide a finalized failed execution: {evidence}")
    return evidence


def transaction_record(tx_hash: str, finality: dict) -> dict:
    return {"hash": tx_hash, "explorer": f"{EXPLORER}/tx/{tx_hash}", **finality}


def write(contract: str, method: str, args: list[str], expect_success: bool = True, signer: str = "deployer") -> tuple[str, dict]:
    if os.environ.get("GENLAYER_PRIVATE_KEY") or (signer in ("admin", "challenger") and os.environ.get("SOULSTAMP_ADMIN_PRIVATE_KEY")):
        output = submit("write", contract, method, json.dumps(args), signer=signer)
    else:
        output = submit("write", contract, method, "--args", *args)
    tx_hash = extract_hash(output)
    finality = finalize(tx_hash, expect_success=expect_success)
    expected_signer = derived_signer_address(signer)
    observed_signer = str(finality.get("sender", "")).lower()
    if expected_signer is not None and observed_signer != expected_signer:
        raise RuntimeError(f"Transaction {tx_hash} was signed by {observed_signer}, expected {expected_signer}")
    if finality.get("calldataDecoded") is not True:
        raise RuntimeError(f"Transaction {tx_hash} did not expose decodable calldata")
    if finality.get("method") != method:
        raise RuntimeError(f"Transaction {tx_hash} called {finality.get('method')!r}, expected {method!r}")
    if finality.get("args") != args:
        raise RuntimeError(f"Transaction {tx_hash} arguments did not match {args!r}: {finality.get('args')!r}")
    return tx_hash, finality


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

    lifecycle_plan = parse_lifecycle_plan(
        os.environ.get("SOULSTAMP_LIVE_LIFECYCLE_JSON"),
        # Full lifecycle evidence is the safe default. An operator may set
        # SOULSTAMP_REQUIRE_FULL_LIFECYCLE=0 only for an explicitly partial
        # deployment probe; that artifact must not be presented as completion.
        require_full=os.environ.get("SOULSTAMP_REQUIRE_FULL_LIFECYCLE", "1") != "0",
    )
    admin_signer = derived_signer_address("admin")
    if admin_signer is not None and admin_signer != admin.lower():
        raise RuntimeError("SOULSTAMP_ADMIN_PRIVATE_KEY does not match SOULSTAMP_ADMIN_ADDRESS")

    if os.environ.get("GENLAYER_PRIVATE_KEY"):
        deploy_output = submit("deploy", "contracts/soul_stamp.py", admin, OLD_CONTRACT, signer="deployer")
    else:
        deploy_output = submit("deploy", "--contract", "contracts/soul_stamp.py", "--args", admin, OLD_CONTRACT)
    deploy_tx = extract_hash(deploy_output)
    deploy_finality = finalize(deploy_tx)
    expected_deployer = derived_signer_address("deployer")
    if expected_deployer is not None and str(deploy_finality.get("sender", "")).lower() != expected_deployer:
        raise RuntimeError(
            f"Deployment {deploy_tx} was signed by {deploy_finality.get('sender')!r}, expected {expected_deployer}"
        )
    contract_address = deploy_finality.get("contractAddress") or extract_address(deploy_output)

    remote_source = subprocess.run(["node", str(CODE_READER), contract_address, RPC], cwd=ROOT, text=True, capture_output=True)
    if remote_source.returncode:
        raise RuntimeError(remote_source.stderr or "Unable to read deployed source")
    remote_source_text = remote_source.stdout
    local_source = (ROOT / "contracts" / "soul_stamp.py").read_text(encoding="utf-8")
    if canonical_source(remote_source_text) != canonical_source(local_source):
        raise RuntimeError("Exact source parity check failed after line-ending normalization; deployment is not recorded as valid.")

    deployed_stats = read_view(contract_address, "get_stats", [])
    if not isinstance(deployed_stats, dict) or deployed_stats.get("verifier_version") != "soulstamp-v3.0-continuity":
        raise RuntimeError("Deployed contract did not expose the expected v3 verifier state")

    proof = {
        "protocol": "SoulStamp v3 identity continuity",
        "network": {"name": "Studionet", "chain_id": 61999, "rpc": RPC},
        "cli_version": cli_version,
        "contract_address": contract_address,
        "deployment_transaction": transaction_record(deploy_tx, deploy_finality),
        "source_sha256": source_sha256(local_source),
        "api_source_sha256": source_sha256(remote_source_text),
        "source_parity": "exact_after_line_ending_normalization",
        "source_line_ending_note": "Studionet source is compared after CRLF/CR to LF normalization.",
        "deployed_state": {
            "method": "get_stats",
            "assertions": [{"path": "verifier_version", "expected": "soulstamp-v3.0-continuity", "actual": deployed_stats.get("verifier_version")}],
            "result": deployed_stats,
        },
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "explorer": f"{EXPLORER}/address/{contract_address}",
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
        signer="deployer",
    )
    proof["negative_lifecycle"].append({
        "method": "execute_wallet_recovery",
        "args": [negative_id],
        "expected_success": False,
        "transaction": transaction_record(negative_hash, negative_finality),
    })

    # A deployment plus source parity is safe to automate. Full positive
    # challenge/recovery requires real fresh social evidence; run the explicit
    # phase below only when the operator supplies it and accepts the proof.
    if lifecycle_plan:
        for item in lifecycle_plan:
            method = str(item["method"])
            args = [str(value) for value in item.get("args", [])]
            expect_success = bool(item.get("expect_success", True))
            signer = str(item.get("signer", "deployer"))
            tx_hash, finality = write(contract_address, method, args, expect_success=expect_success, signer=signer)
            expected_sender = str(item["expect_sender"]).lower()
            if str(finality.get("sender", "")).lower() != expected_sender:
                raise RuntimeError(
                    f"Lifecycle step {method} was signed by {finality.get('sender')!r}, expected {expected_sender!r}"
                )
            entry = {"method": method, "args": args, "signer": signer, "expected_success": expect_success, "transaction": transaction_record(tx_hash, finality)}
            if expect_success:
                verify_spec = item.get("verify")
                if not isinstance(verify_spec, dict):
                    raise RuntimeError(f"Successful lifecycle step {method} requires a post-state verify specification")
                entry["state_verification"] = verify_view(contract_address, verify_spec)
            (proof["lifecycle"] if expect_success else proof["negative_lifecycle"]).append(entry)

    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    (LIVE_DIR / "studionet-v3-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"contract_address": contract_address, "deployment_tx": deploy_tx, "source_parity": "exact_after_line_ending_normalization", "lifecycle_steps": len(proof["lifecycle"]), "negative_lifecycle_steps": len(proof["negative_lifecycle"])}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"LIVE PROOF BLOCKED: {error}", file=sys.stderr)
        raise SystemExit(1)
