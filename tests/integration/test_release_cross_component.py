"""Executable release checks for the deployed contract, frontend and Worker.

These checks are opt-in because they perform real network reads.  They never
submit transactions and therefore remain safe in CI without operator secrets.
"""

import json
import os
import subprocess
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import pytest
from gltest import get_contract_factory


pytestmark = pytest.mark.live


def _get_json(url: str) -> dict:
    with urlopen(Request(url, headers={"User-Agent": "soulstamp-release-check"}), timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


@pytest.mark.skipif(
    os.environ.get("RUN_LIVE_STUDIONET") != "1"
    or not os.environ.get("SOULSTAMP_LIVE_CONTRACT_ADDRESS")
    or not os.environ.get("SOULSTAMP_FRONTEND_URL")
    or not os.environ.get("SOULSTAMP_DISCORD_WORKER_URL")
    or not os.environ.get("SOULSTAMP_LIVE_TX_HASH"),
    reason="set live contract, frontend, Worker and finalized tx environment for release checks",
)
def test_live_release_cross_component_finality_and_post_state():
    root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    contract_address = os.environ["SOULSTAMP_LIVE_CONTRACT_ADDRESS"]
    rpc = os.environ.get("SOULSTAMP_LIVE_RPC", "https://studio.genlayer.com/api")

    receipt = subprocess.run(
        ["node", "scripts/finalized_tx.mjs", os.environ["SOULSTAMP_LIVE_TX_HASH"], rpc],
        cwd=root, check=True, capture_output=True, text=True,
    )
    finalized = json.loads(receipt.stdout.strip().splitlines()[-1])
    assert finalized["statusName"] == "FINALIZED"
    assert finalized["rawResultName"] == "MAJORITY_AGREE"
    assert finalized["txExecutionResultName"] == "FINISHED_WITH_RETURN"
    assert finalized["rawExecutionResults"]
    assert finalized["authoritativeExecutionResult"] == "FINISHED_WITH_RETURN"

    worker = _get_json(os.environ["SOULSTAMP_DISCORD_WORKER_URL"].rstrip("/") + "/health")
    assert worker["ok"] is True
    assert worker["public_base_url"].rstrip("/") == os.environ["SOULSTAMP_DISCORD_WORKER_URL"].rstrip("/")

    frontend_url = os.environ["SOULSTAMP_FRONTEND_URL"].rstrip("/")
    with urlopen(Request(frontend_url, headers={"User-Agent": "soulstamp-release-check"}), timeout=20) as response:
        html = response.read().decode("utf-8")
    script_urls = []
    for fragment in html.split("<script"):
        if "src=" not in fragment:
            continue
        src = fragment.split("src=", 1)[1].split('"', 2)[1] if '"' in fragment.split("src=", 1)[1] else ""
        if src:
            script_urls.append(urljoin(frontend_url + "/", src))
    assert script_urls
    bundles = []
    for script_url in script_urls:
        with urlopen(Request(script_url, headers={"User-Agent": "soulstamp-release-check"}), timeout=20) as response:
            bundles.append(response.read().decode("utf-8", errors="replace"))
    assert contract_address.lower() in "\n".join(bundles).lower()

    factory = get_contract_factory(contract_file_path="contracts/soul_stamp.py")
    contract = factory.build_contract(contract_address)
    stats = contract.get_stats(args=[]).call()
    assert stats["verifier_version"] == "soulstamp-v3.0-continuity"
    assert stats["admin"]
    assert stats["legacy_contract_address"]
    eligibility = contract.consumer_eligibility(args=[contract_address]).call()
    assert {"eligible", "reason", "principal_id", "active_proofs"}.issubset(eligibility)
