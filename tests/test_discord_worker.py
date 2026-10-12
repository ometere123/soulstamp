from pathlib import Path


WORKER = Path("backend/index.js")


def test_worker_accepts_v3_challenge_evidence_codes_and_rejects_other_shapes():
    source = WORKER.read_text(encoding="utf-8")
    assert "SOULSTAMP-(VERIFY|CHALLENGE|REBUT)-[A-F0-9]{12}" in source
    assert "pendingId" in source
    assert "claimedId !== session.user.id" in source


def test_worker_attestations_expire_at_signed_payload_expiry_and_are_not_cached():
    source = WORKER.read_text(encoding="utf-8")
    assert "ATTESTATION_TTL_SECONDS = 5 * 60" in source
    assert "exp: attestation.expires_at" in source
    assert "payload.attestation.expires_at <= nowSeconds()" in source
    assert '"cache-control": "no-store"' in source


def test_worker_fails_closed_without_a_strong_hmac_secret():
    source = WORKER.read_text(encoding="utf-8")
    assert "BACKEND_SESSION_SECRET must be configured with at least 32 characters" in source
    assert 'env.BACKEND_SESSION_SECRET || "dev-only-change-me"' not in source
