import os

import pytest
from gltest import get_contract_factory


pytestmark = pytest.mark.live


@pytest.mark.skipif(
    os.environ.get("RUN_LIVE_STUDIONET") != "1" or not os.environ.get("SOULSTAMP_LIVE_CONTRACT_ADDRESS"),
    reason="set RUN_LIVE_STUDIONET=1 and SOULSTAMP_LIVE_CONTRACT_ADDRESS for real Studionet checks",
)
def test_studionet_v3_has_public_eligibility_and_challenge_interfaces():
    factory = get_contract_factory(contract_file_path="contracts/soul_stamp.py")
    contract = factory.build_contract(os.environ["SOULSTAMP_LIVE_CONTRACT_ADDRESS"])
    stats = contract.get_stats(args=[]).call()
    assert stats["verifier_version"] == "soulstamp-v3.0-continuity"
    eligibility = contract.consumer_eligibility(args=[os.environ["SOULSTAMP_LIVE_CONTRACT_ADDRESS"]]).call()
    assert set(("eligible", "reason", "principal_id", "active_proofs")).issubset(eligibility)
    assert isinstance(contract.get_all_challenges(args=[0, 10]).call(), list)
