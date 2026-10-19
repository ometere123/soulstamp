# V4 threat model and bounded assumptions

| Threat | Control | Remaining assumption |
|---|---|---|
| Forged Google token | Worker code exchange, state/PKCE/nonce, issuer/audience/JWKS/signature/time/email checks; V4 only accepts Worker-origin attestations. | Worker secrets and Google issuer configuration must remain protected. |
| Google replay or relink | Short-lived attestation plus on-chain nonce/attestation-ID one-use and commitment uniqueness. | A compromised Worker could issue an attestation until its secret is rotated/revoked. |
| Forged Passport score | Validators read the configured decoder at the same pinned block and compare ABI facts. | RPC providers are external dependencies; agreement is not a cryptographic bridge. |
| Wrong subject score | Subject wallet is bound in the V4 request and the exact `eth_call`. | The decoder's documented semantics are assumed. |
| Arc receipt forgery | Strict-equality normalized receipt consensus, successful status, committed block, escrow emitter, topic, log index and all request bindings. | Arc RPC availability and settlement operator liveness. |
| Double spend/refund race | Request/intent/settlement keys, one-way status transitions, escrow liabilities and reentrancy guard. | ERC-20 predeploy continues to implement the tested interface. |
| Unsettled PASS | V4 creates no consumable record until the actual Arc settlement event is consumed. | The operator must submit before the 72-hour refund window; otherwise payer recovery wins over availability. |
| Policy substitution | Canonical policy hash is bound to consent, payment and pass. Existing terms are not silently rewritten. | Organisations must use the published policy hash in integrations. |
| V3 state drift | Consumer eligibility re-reads V3 state and rejects stale, revoked, contested or recovery-pending identity. | V3 view interface and address remain the accepted authority. |
| Required-credential revocation bypass | Eligibility rechecks every required platform, status, strength and dossier expiry instead of relying only on aggregate V3 eligibility. | The V3 view must continue exposing the accepted proof dossier fields. |
| V3 marker misread as Unix time | `verified_at` is treated as an opaque marker; dossier issue/expiry and status are the freshness inputs. | Legacy dossiers without an issue timestamp use their authenticated expiry boundary. |
| Stale sponsored consent | Consent expiry is bound into the request and payment intent; expired consent cannot authorize a new deposit. | A subject must provide a fresh consent signature when the original window expires. |
| Interrupted payment or refund false success | Arc escrow record/event recovery is keyed by request and original payer; refund UX waits for both Arc and GenLayer post-state. | Cross-chain operator/consumer liveness remains required for a settled result. |
| Multi-wallet social identities | Canonical-ID and Google commitment uniqueness plus explicit assurance language. | Social account control is not proof of one unique human. |

No external auditor has certified this code. This is an engineering threat
model, not a security-audit claim.
