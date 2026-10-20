import json
import os


CONTRACT = "contracts/soulstamp_trustpass.py"
ADMIN = "0x" + "11" * 20
OWNER = "0x" + "22" * 20
SPONSOR = "0x" + "33" * 20
V3 = "0x" + "44" * 20
ESCROW = "0x" + "55" * 20
DECODER = "0x" + "66" * 20
EAS = "0x4200000000000000000000000000000000000021"
SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020"
UNIFIED_SCHEMA_UID = "0x81d8758ccd97bbeea7642df29001f6046a676b3c24f808c4297db5ee36838dd8"
UNIFIED_RESOLVER = "0xa2c832b63a20c06ccc2ca31c12b8248452729a4d"
OFFICIAL_ATTESTER = "0x8b1a76795e3cbadd79c5410d2c4d4827d9c1503a"
ATTESTATION_UID = "0x" + "65" * 32
PASSPORT_CREATED = 1_792_415_168
PASSPORT_EXPIRATION = 1_800_191_157


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


def abi_word(value):
    if isinstance(value, str) and value.startswith("0x"):
        value = value[2:]
    else:
        value = hex(int(value))[2:]
    return value.rjust(64, "0")


def abi_string(value):
    raw = value.encode().hex()
    return abi_word(len(raw) // 2) + raw.ljust(((len(raw) + 63) // 64) * 64, "0")


def unified_data(*, score=446980, scorer_id=335, threshold=200000, passing=True):
    elements = []
    for provider, stamp_score in (("Google", 100), ("Discord", 90)):
        elements.append(abi_word(64) + abi_word(stamp_score) + abi_string(provider))
    offset = len(elements) * 32
    offsets = []
    for element in elements:
        offsets.append(abi_word(offset))
        offset += len(element) // 2
    return "0x" + "".join([
        abi_word(1 if passing else 0), abi_word(4), abi_word(scorer_id), abi_word(score), abi_word(threshold), abi_word(192),
        abi_word(len(elements)), "".join(offsets), "".join(elements),
    ])


def eas_attestation(*, recipient=OWNER, schema=UNIFIED_SCHEMA_UID, attester=OFFICIAL_ATTESTER, data=None, expiration=PASSPORT_EXPIRATION, revocation=0):
    data = data or unified_data()
    padded_data = data[2:].ljust(((len(data) - 2 + 63) // 64) * 64, "0")
    return "0x" + "".join([
        ATTESTATION_UID[2:], schema[2:], abi_word(PASSPORT_CREATED), abi_word(expiration), abi_word(revocation), abi_word(1), abi_word(0),
        abi_word(recipient), abi_word(attester), abi_word(320), abi_word((len(data) - 2) // 2), padded_data,
    ])


def schema_record(schema="bool passing_score, uint8 score_decimals, uint128 scorer_id, uint32 score, uint32 threshold, tuple(string provider, uint256 score)[] stamps", resolver=UNIFIED_RESOLVER):
    return "0x" + abi_word(96) + abi_word(resolver) + abi_word(1) + abi_string(schema)


def unified_rpc_fixture(*, recipient=OWNER, schema=UNIFIED_SCHEMA_UID, attester=OFFICIAL_ATTESTER, data=None, expiration=PASSPORT_EXPIRATION, revocation=0, resolver=UNIFIED_RESOLVER):
    def rpc(method, params):
        if method == "eth_chainId":
            return "0xaa37dc"
        if method == "eth_getBlockByNumber":
            return {"number": "0x64", "hash": "0x" + "ab" * 32, "timestamp": hex(PASSPORT_CREATED)}
        if method == "eth_getCode":
            return "0x6001600155"
        if method == "eth_call":
            call = params[0]
            if str(call.get("to", "")).lower() == EAS:
                return eas_attestation(recipient=recipient, schema=schema, attester=attester, data=data, expiration=expiration, revocation=revocation)
            if str(call.get("to", "")).lower() == SCHEMA_REGISTRY:
                return schema_record(resolver=resolver)
        raise AssertionError((method, params))
    return rpc


def test_v4_constructor_binds_v3_arc_and_human_passport_config(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    stats = contract.get_stats()
    assert stats["contract_version"] == "soulstamp-v4.2-unified-passport-compatibility"
    assert stats["v3_contract_address"] == V3
    assert stats["arc_escrow_address"] == ESCROW
    assert stats["human_passport_chain_id"] == 11155420
    assert stats["human_passport_decoder_address"] == DECODER
    assert stats["human_passport_threshold_raw"] == 200000
    assert stats["human_passport_evidence_mode"] == "EAS_UNIFIED_V1_WITH_LEGACY_FALLBACK"
    assert stats["human_passport_eas_address"] == EAS
    assert stats["human_passport_unified_schema_uid"] == UNIFIED_SCHEMA_UID
    assert stats["human_passport_unified_resolver"] == UNIFIED_RESOLVER
    assert stats["human_passport_permitted_attester"] == OFFICIAL_ATTESTER
    assert stats["human_passport_approved_scorer_id"] == 335
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
    consented = contract.get_request(request["request_id"])
    assert consented["state"] == "AWAITING_PAYMENT"
    assert consented["payment_intent_expires_at"] == consented["consent_expires_at"]
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


def test_v3_event_marker_is_not_treated_as_unix_time_and_dossier_expiry_is_authoritative(direct_vm, direct_deploy):
    contract = deploy(direct_deploy)
    now = 2_000_000_000
    facts = {
        "available": True,
        "accounts": [{
            "platform": "github", "proof_status": "ACTIVE", "proof_strength": "STRONG",
            "confidence_score": 92, "is_active": True,
            # This mirrors the actual V3 get_identity() shape. verified_at is
            # an event marker; the dossier carries the freshness fields.
            "verified_at": 1, "canonical_platform_id": "123",
            "dossier": {
                "evidence_issued_at": 0,
                "evidence_expires_at": now + 30 * 24 * 60 * 60,
                "proof_status": "ACTIVE", "proof_strength": "STRONG",
            },
        }],
    }
    result = contract._credential_facts(facts, json.loads(policy()), now)
    assert result["github"]["active"] is True
    assert result["github"]["fresh"] is True
    assert result["github"]["acceptable"] is True
    facts["accounts"][0]["dossier"]["evidence_expires_at"] = now - 1
    expired = contract._credential_facts(facts, json.loads(policy()), now)
    assert expired["github"]["fresh"] is False
    assert expired["github"]["acceptable"] is False


def test_consumer_rechecks_every_required_v3_credential(direct_vm, direct_deploy, monkeypatch):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy("github-discord-v1", policy(credentials=["github", "discord"]))
    stored_policy = contract.get_policy("github-discord-v1")
    now = 2_000_000_000
    record = {
        "subject": OWNER, "policy_id": "github-discord-v1", "outcome": "PASS", "state": "ACTIVE",
        "invalidated": False, "expires_at": now + 3600, "arc_settlement_tx_hash": "0xsettled",
        "policy_hash": stored_policy["policy_hash"], "assessment_id": "ASSESSMENT-1",
    }
    accounts = [
        {"platform": "github", "proof_status": "ACTIVE", "proof_strength": "STRONG", "confidence_score": 92,
         "is_active": True, "canonical_platform_id": "gh-1", "evidence_issued_at": 0, "evidence_expires_at": now + 3600},
        {"platform": "discord", "proof_status": "ACTIVE", "proof_strength": "STRONG", "confidence_score": 94,
         "is_active": True, "canonical_platform_id": "dc-1", "evidence_issued_at": now - 60, "evidence_expires_at": now + 3600},
    ]
    monkeypatch.setattr(contract, "_now", lambda: now)
    monkeypatch.setattr(contract, "_read_v3", lambda _subject: {"available": True, "eligible": True, "identity_state": "ACTIVE", "is_flagged": False, "accounts": accounts})
    assert contract._pass_eligibility(record, "github-discord-v1", OWNER)["eligible"] is True
    accounts[1]["proof_status"] = "REVOKED"
    result = contract._pass_eligibility(record, "github-discord-v1", OWNER)
    assert result["eligible"] is False
    assert result["reason"] == "REQUIRED_CREDENTIAL_DISCORD_INVALID"


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


def _unified_request(direct_vm, direct_deploy, policy_id="unified-passport-v1"):
    contract = deploy(direct_deploy)
    direct_vm.sender = OWNER
    contract.create_policy(policy_id, policy(humanity=True))
    contract.create_assessment_request(policy_id, OWNER, "sybil_screening", False)
    request = contract.get_requests(OWNER, 0, 10)[0]
    contract.consent_assessment(request["request_id"], request["purpose"], "passport-consent-123456", request["created_at"] + 300)
    return contract, contract.get_request(request["request_id"])


def test_unified_human_passport_attestation_is_independently_decoded_and_snapshotted(direct_vm, direct_deploy, monkeypatch):
    contract, request = _unified_request(direct_vm, direct_deploy)
    monkeypatch.setattr(contract, "_passport_rpc", unified_rpc_fixture())
    monkeypatch.setattr(contract, "_now", lambda: PASSPORT_CREATED + 60)
    result = contract.refresh_humanity_evidence_unified(request["request_id"], ATTESTATION_UID, 100)
    assert json.loads(result)["raw_score"] == 446980
    snapshot = contract.get_humanity_evidence(request["request_id"])
    assert snapshot["evidence_type"] == "eas_unified_v1"
    assert snapshot["attestation_uid"] == ATTESTATION_UID
    assert snapshot["scorer_id"] == 335
    assert snapshot["score_decimals"] == 4
    assert snapshot["raw_score"] == 446980
    assert snapshot["evidence_commitment"].startswith("0x")
    facts = contract._humanity_facts(contract.get_request(request["request_id"]), contract.get_policy("unified-passport-v1"), PASSPORT_CREATED + 60)
    assert facts["valid"] is True
    assert facts["reason"] == "HUMANITY_UNIFIED_ATTESTATION_VALID"


def test_unified_passport_rejects_wrong_recipient_schema_attester_and_revocation(direct_vm, direct_deploy, monkeypatch):
    contract, _request = _unified_request(direct_vm, direct_deploy, "unified-negative-v1")
    cases = [
        (unified_rpc_fixture(recipient=SPONSOR), "recipient"),
        (unified_rpc_fixture(schema="0x" + "99" * 32), "schema UID"),
        (unified_rpc_fixture(attester=SPONSOR), "attester"),
        (unified_rpc_fixture(revocation=PASSPORT_CREATED), "revoked"),
        (unified_rpc_fixture(data=unified_data(scorer_id=334)), "scorer"),
    ]
    for fixture, message in cases:
        monkeypatch.setattr(contract, "_passport_rpc", fixture)
        with direct_vm.expect_revert(message):
            contract._passport_unified_stable_facts(OWNER, ATTESTATION_UID, 100)


def test_unified_passport_rejects_malformed_dynamic_stamp_abi(direct_vm, direct_deploy, monkeypatch):
    contract, _request = _unified_request(direct_vm, direct_deploy, "unified-malformed-v1")
    monkeypatch.setattr(contract, "_passport_rpc", unified_rpc_fixture(data="0x1234"))
    with direct_vm.expect_revert("truncated"):
        contract._passport_unified_stable_facts(OWNER, ATTESTATION_UID, 100)


def test_unified_passport_rejects_expired_evidence_before_snapshot(direct_vm, direct_deploy, monkeypatch):
    contract, request = _unified_request(direct_vm, direct_deploy, "unified-expired-v1")
    monkeypatch.setattr(contract, "_passport_rpc", unified_rpc_fixture(expiration=PASSPORT_CREATED + 1))
    monkeypatch.setattr(contract, "_now", lambda: PASSPORT_CREATED + 60)
    with direct_vm.expect_revert("expired"):
        contract.refresh_humanity_evidence_unified(request["request_id"], ATTESTATION_UID, 100)


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
    request = contract.get_request(request["request_id"])
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
