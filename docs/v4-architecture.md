# V4 architecture

SoulStamp V4 is a new assessment authority layered over the immutable V3
identity contract. V4 reads V3 through GenLayer inter-contract views and
stores request terms, evidence references, decisions and consumer eligibility
without mutating V3.

## Trust boundaries

- V3 is authoritative for source-account ownership and current identity
  eligibility.
- The Cloudflare Worker is an authenticated issuer for Google and the existing
  Discord OAuth attestations. GenLayer validators fetch its HTTPS response;
  the contract does not pretend to cryptographically verify Google's original
  ID token.
- Human Passport is read from the configured Optimism Sepolia decoder at a
  pinned block. The RPC provider is an external dependency; validator
  agreement proves consistent retrieval of the configured chain/contract/block,
  not that the provider itself is a trustless oracle.
- Arc settlement is operator-mediated because Arc and GenLayer have no atomic
  cross-chain transaction. V4 consumes the actual Arc settlement event before
  activating a TrustPass.

## State model

`AWAITING_CONSENT → AWAITING_PAYMENT → FUNDED → EVALUATING →
EVALUATED_PENDING_SETTLEMENT → ACTIVE | COMPLETED_FAIL |
COMPLETED_INCONCLUSIVE`. Before funding, the request may become `CANCELLED`
or `EXPIRED`. Expiry/refund paths are `EXPIRED`, `UNDELIVERABLE` and
`REFUNDED`; they never activate a pass.

The 72-hour assessment/refund deadline starts at `funded_at`, when the Arc
deposit is accepted by V4, rather than at request creation. Unpaid requests use
their shorter consent/payment-intent windows. Disabling a policy stops new
requests and future eligibility but does not prevent an already-funded
assessment from settling under its stored policy hash and version.

The Arc escrow state is `NONE → ESCROWED → SETTLED | REFUNDED`. Settlement and
refund are mutually exclusive and the payer is stored on-chain as the only
refund recipient.

## V4.1 security-correction rules

V3 `verified_at` is an opaque event marker, not a timestamp. V4 uses the V3
proof dossier's authenticated issue/expiry fields and current status; when an
old proof has no real issue timestamp, the V3 dossier expiry remains the
freshness boundary rather than inventing an age from the marker. Eligibility
then re-reads every credential required by the selected policy. A single
required credential becoming revoked, stale, weak, conflicted or otherwise
ineligible invalidates the consumer result.

Consent expiry is part of the request/payment-intent binding. A deposit made
within the consent window can complete its normal confirmation path, but an
expired consent cannot create or authorize a new sponsored payment. The
frontend derives interrupted-payment state from the Arc escrow record and
`PaymentDeposited` event, keyed by the original payer and request, so reloads
cannot cause a second deposit. Refund success is displayed only after the Arc
refund and the GenLayer refund confirmation both finalize successfully.
