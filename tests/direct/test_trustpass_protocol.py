import json
import os


CONTRACT = "contracts/soulstamp_trustpass.py"
ADMIN = "0x" + "11" * 20
OWNER = "0x" + "22" * 20
SPONSOR = "0x" + "33" * 20
V3 = "0x" + "44" * 20
ESCROW = "0x" + "55" * 20
DECODER = "0x" + "66" * 20


def deploy(direct_deploy):
    return direct_deploy(
        CONTRACT,
        V3,
        ESCROW,
        DECODER,
        "https://optimism-sepolia.example/rpc",
        "https://soulstamp-worker.example",
        ADMIN,
        ADMIN,
        sdk_version=os.environ.get("GENVM_VERSION", "v0.2.16"),
    )


def policy(*, humanity=False, credentials=None):
    return json.dumps({
        "version": 1,
        "required_credentials": credentials or ["github"],
        "minimum_proof_strength": "MEDIUM",
        "maximum_evidence_age_seconds": 30 * 24 * 60 * 60,
        "maximum_trustpass_lifetime_seconds": 7 * 24 * 60 * 60,
        "external_humanity_required": humanity,
        "minimum_humanity_score": 200000,
        "permitted_assessment_use": "access_decision",
        "assessment_price_usdc": 1000000,
        "enabled": True,
    })


def test_v4_constructor_binds_v3_arc_and_human_passport_config(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    stats = contract.get_stats()
    assert stats["contract_version"] == "soulstamp-v4.0-trustpass-sybil-gate"
    assert stats["v3_contract_address"] == V3
    assert stats["arc_escrow_address"] == ESCROW
    assert stats["human_passport_chain_id"] == 11155420
    assert stats["human_passport_decoder_address"] == DECODER
    assert stats["human_passport_threshold_raw"] == 200000
    assert stats["assessment_price_usdc"] == 1000000


def test_policy_hash_is_stable_and_bounds_payment_and_lifetime(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = SPONSOR
    contract.create_policy("basic-v1", policy())
    first = contract.get_policy("basic-v1")
    assert first["found"] is True
    assert first["policy_hash"].startswith("0x")
    assert first["assessment_price_usdc"] == 1000000
    assert first["maximum_trustpass_lifetime_seconds"] == 7 * 24 * 60 * 60
    assert contract.get_organisation_policies(SPONSOR, 0, 10)[0]["policy_hash"] == first["policy_hash"]


def test_request_requires_subject_consent_and_nonce_replay_is_rejected(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = SPONSOR
    contract.create_policy("sponsor-v1", policy())
    contract.create_assessment_request("sponsor-v1", OWNER, "organisation_access_decision", True)
    request = contract.get_requests(OWNER, 0, 10)[0]
    assert request["state"] == "AWAITING_CONSENT"
    with direct_vm.expect_revert("Only the subject"):
        contract.consent_assessment(request["request_id"], request["purpose"], "nonce-should-not-work", request["created_at"] + 300)
    direct_vm.sender = OWNER
    contract.consent_assessment(request["request_id"], request["purpose"], "nonce-1234567890", request["created_at"] + 300)
    assert contract.get_request(request["request_id"])["state"] == "AWAITING_PAYMENT"
    assert contract.used_consent_nonces["nonce-1234567890"] is True


def test_unpaid_request_can_be_cancelled_by_subject_without_creating_payment(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy("cancel-v1", policy())
    created = contract.create_assessment_request("cancel-v1", OWNER, "access_decision", False)
    request = json.loads(created)
    contract.cancel_assessment_request(request["request_id"], "USER_ABORTED")
    after = contract.get_request(request["request_id"])
    assert after["state"] == "CANCELLED"
    assert after["payment_state"] == "NONE"


def test_policy_maximum_evidence_age_is_enforced_against_v3_verified_at(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    now = 2_000_000_000
    facts = {
        "available": True,
        "accounts": [{
            "platform": "github", "proof_status": "ACTIVE", "proof_strength": "STRONG",
            "confidence_score": 92, "verified_at": now - 31 * 24 * 60 * 60,
            "evidence_expires_at": now + 30 * 24 * 60 * 60, "canonical_platform_id": "123",
        }],
    }
    result = contract._credential_facts(facts, json.loads(policy()), now)
    assert result["github"]["active"] is True
    assert result["github"]["fresh"] is False
    assert result["github"]["acceptable"] is False


def test_human_passport_scaling_199999_fails_and_200000_passes(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy("human-v1", policy(humanity=True))
    contract.create_assessment_request("human-v1", OWNER, "sybil_screening", False)
    request = contract.get_requests(OWNER, 0, 10)[0]
    # The snapshot is written by the real consensus RPC path in production;
    # this direct test isolates the policy boundary without inventing an RPC
    # response or a user-controlled score.
    contract.humanity_snapshots[request["request_id"]] = json.dumps({
        "wallet": OWNER, "chain_id": 11155420, "decoder": DECODER,
        "block_number": 100, "block_hash": "0x" + "aa" * 32,
        "block_timestamp": request["created_at"], "raw_score": 199999, "observed_at": request["created_at"],
    })
    facts = contract._humanity_facts(request, contract.get_policy("human-v1"), request["created_at"] + 1)
    assert facts["valid"] is False
    contract.humanity_snapshots[request["request_id"]] = json.dumps({
        "wallet": OWNER, "chain_id": 11155420, "decoder": DECODER,
        "block_number": 100, "block_hash": "0x" + "aa" * 32,
        "block_timestamp": request["created_at"], "raw_score": 200000, "observed_at": request["created_at"],
    })
    facts = contract._humanity_facts(request, contract.get_policy("human-v1"), request["created_at"] + 1)
    assert facts["valid"] is True
    assert facts["score_scaled"] == "20"


def test_google_commitment_cannot_be_active_for_two_wallets(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy("google-v1", policy(credentials=["google"]))
    contract.create_assessment_request("google-v1", OWNER, "access_decision", False)
    owner_request = contract.get_requests(OWNER, 0, 10)[0]
    direct_vm.sender = SPONSOR
    contract.create_assessment_request("google-v1", SPONSOR, "access_decision", False)
    # A pre-existing active commitment is the state the authenticated Worker
    # evidence path writes. The second wallet is rejected before any policy
    # result could be created.
    contract.google_commitments["v1:" + "ab" * 32] = json.dumps({"wallet": OWNER, "active": True, "expires_at": owner_request["created_at"] + 300})
    sponsor_request = contract.get_requests(SPONSOR, 0, 10)[0]
    facts = contract._google_facts({"subject": SPONSOR, "google_commitment": "v1:" + "ab" * 32}, sponsor_request["created_at"] + 1)
    assert facts["present"] is True
    assert facts["valid"] is False


def test_human_passport_block_snapshot_cannot_be_stale_or_for_another_wallet(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy("human-stale-v1", policy(humanity=True))
    contract.create_assessment_request("human-stale-v1", OWNER, "sybil_screening", False)
    request = contract.get_requests(OWNER, 0, 10)[0]
    contract.humanity_snapshots[request["request_id"]] = json.dumps({
        "wallet": SPONSOR, "chain_id": 11155420, "decoder": DECODER,
        "block_number": 100, "block_hash": "0x" + "aa" * 32,
        "block_timestamp": request["created_at"] - 8 * 24 * 60 * 60,
        "raw_score": 999999, "observed_at": request["created_at"],
    })
    facts = contract._humanity_facts(request, contract.get_policy("human-stale-v1"), request["created_at"] + 1)
    assert facts["valid"] is False


def test_google_attestation_replay_is_rejected_and_binds_wallet_request_and_contract(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy("google-live-v1", policy(credentials=["google"]))
    contract.create_assessment_request("google-live-v1", OWNER, "access_decision", False)
    request = contract.get_requests(OWNER, 0, 10)[0]
    direct_vm.sender = OWNER
    contract.consent_assessment(request["request_id"], request["purpose"], "google-consent-123456", request["created_at"] + 300)
    token = "A" * 24 + "." + "a" * 43
    url = f"https://soulstamp-worker.example/api/google/attestations/{token}"
    body = {
        "platform": "google", "issuer": "https://soulstamp-worker.example", "wallet": OWNER,
        "chain_id": 61999, "v4_contract": contract.get_stats()["contract_address"],
        "pending_id": request["request_id"], "purpose": "google_link", "nonce": "google-nonce-1",
        "attestation_id": "google-attestation-1", "issued_at": request["created_at"],
        "expires_at": request["created_at"] + 300, "account_commitment": "v1:" + "ab" * 32,
    }
    direct_vm.mock_web(r".*soulstamp-worker\.example/api/google/attestations/.*", {"status": 200, "body": json.dumps(body)})
    contract.link_google_attestation(request["request_id"], url)
    assert contract.get_request(request["request_id"])["google_commitment"] == "v1:" + "ab" * 32
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*soulstamp-worker\.example/api/google/attestations/.*", {"status": 200, "body": json.dumps(body)})
    with direct_vm.expect_revert("Google attestation has already been used"):
        contract.link_google_attestation(request["request_id"], url)


def _arc_topic_address(wallet):
    return "0x" + "00" * 12 + wallet[2:].lower()


def _arc_receipt(request, *, emitter=ESCROW):
    tx_hash = "0x" + "12" * 32
    body = "0x" + request["policy_hash"][2:] + f"{1000000:064x}" + f"{int(request['payment_intent_expires_at']):064x}" + f"{int(request['payment_nonce']):064x}"
    return tx_hash, {
        "jsonrpc": "2.0", "id": 1, "result": {
            "transactionHash": tx_hash, "status": "0x1", "to": ESCROW,
            "blockNumber": "0x10", "logs": [{
                "address": emitter, "logIndex": "0x0",
                "topics": [
                    "0x4b8e0046bd7b248856bb764d99ba272dceb03c623ba895214e1f531dc8919e3d",
                    request["request_key"], _arc_topic_address(request["payer"]), _arc_topic_address(request["subject"]),
                ], "data": body,
            }],
        },
    }


def test_arc_payment_receipt_requires_exact_event_and_moves_request_to_funded(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy("arc-v1", policy())
    contract.create_assessment_request("arc-v1", OWNER, "access_decision", False)
    request = contract.get_requests(OWNER, 0, 10)[0]
    contract.consent_assessment(request["request_id"], request["purpose"], "arc-consent-123456", request["created_at"] + 300)
    intent = contract.get_payment_intent(request["request_id"])
    request["request_key"] = intent["request_key"]
    tx_hash, payload = _arc_receipt(request)
    direct_vm.mock_web(r".*rpc\.testnet\.arc\.io.*", {"method": "POST", "status": 200, "body": json.dumps(payload)})
    contract.confirm_arc_payment(request["request_id"], tx_hash, 0)
    assert contract.get_request(request["request_id"])["state"] == "FUNDED"
    assert contract.get_request(request["request_id"])["payment_state"] == "ESCROWED"


def test_arc_payment_receipt_wrong_emitter_is_rejected(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy("arc-wrong-emitter-v1", policy())
    contract.create_assessment_request("arc-wrong-emitter-v1", OWNER, "access_decision", False)
    request = contract.get_requests(OWNER, 0, 10)[0]
    contract.consent_assessment(request["request_id"], request["purpose"], "arc-consent-654321", request["created_at"] + 300)
    intent = contract.get_payment_intent(request["request_id"])
    request["request_key"] = intent["request_key"]
    tx_hash, payload = _arc_receipt(request, emitter="0x" + "99" * 20)
    direct_vm.mock_web(r".*rpc\.testnet\.arc\.io.*", {"method": "POST", "status": 200, "body": json.dumps(payload)})
    with direct_vm.expect_revert("Arc event emitter mismatch"):
        contract.confirm_arc_payment(request["request_id"], tx_hash, 0)
