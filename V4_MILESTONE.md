# SoulStamp V4 — TrustPass & Sybil Gate

V4 extends the accepted V3 identity-continuity contract. V3 remains the sole
authority for GitHub, X, Discord, canonical ownership, challenges, recovery,
proof health and identity eligibility. V4 does not write V3 state and cannot
invent or transfer a V3 identity.

## Product boundary

V4 sells a policy-bound, expiring assessment, not a PASS. A policy may return
`PASS`, `FAIL`, or `INCONCLUSIVE`. A genuine adverse fact is a completed
`FAIL`; conflicting evidence is a completed `INCONCLUSIVE`; unavailable
infrastructure, unsettled payment and failed execution remain incomplete.

The two policy tiers are:

- Identity TrustPass: current V3 eligibility and the selected credential
  combination, optionally including a unique Google commitment.
- Sybil-resistant TrustPass: Identity TrustPass plus independently read
  Human Passport decoder evidence for the same subject wallet.

Neither tier claims that multiple social accounts prove one human or prevent
all multi-wallet participation.

## Components

| Component | Responsibility |
|---|---|
| `contracts/soul_stamp.py` | Preserved V3 identity authority at `0x4ed8aF93E64F6411826DeEaa6d2af68DD67C9c3d`. |
| `contracts/soulstamp_trustpass.py` | GenLayer V4 request, consent, policy, evidence, assessment, eligibility and settlement-consumption authority. |
| `evm/SoulStampPaymentEscrow.sol` | Arc Testnet USDC request-bound escrow, one-way settlement, timeout refund and accounting. |
| `backend/index.js` | Existing Discord Worker plus isolated Google OIDC authorization-code/PKCE and short-lived attestation routes. |
| `frontend/src/components/*TrustPass*` | Wallet, policy, consent, Google, Human Passport, Arc payment and organization flows. |

The Arc contract is deliberately bound to V4 in a one-time admin operation.
This resolves the deployment ordering cycle: deploy escrow with a zero V4
address, deploy V4 with the escrow address, then call
`configureGenLayerV4(v4Address)` once. After that, the V4 address is part of
every payment-intent domain and cannot change.

## Deterministic and independent responsibilities

Deterministic state includes policy hashes, request/consent bindings, wallet
and policy checks, prices, state transitions, V3 view facts, stored Google
commitments, Human Passport snapshot age and consumer eligibility. GenLayer
validators independently retrieve Google attestations, Human Passport RPC
facts and Arc receipts where the contract uses `run_nondet_unsafe` or strict
receipt consensus. The LLM is advisory: it supplies bounded reasoning only;
it cannot change an outcome, reason code, wallet, source identity, score,
payment, consent or expiry.

## Payment and settlement

The fixed price is exactly `1_000_000` USDC base units (1 USDC, six ERC-20
decimals) on Arc Testnet chain `5042002`. Native Arc gas remains an 18-decimal
network value and is not used for payment accounting.

1. V4 creates a request and requires subject consent.
2. The payer approves and deposits the exact amount into the Arc escrow.
3. V4 independently verifies the finalised successful `PaymentDeposited`
   receipt, exact emitter, request key, payer, subject, policy, nonce and
   expiry.
4. GenLayer independently evaluates the V3/Google/Passport policy.
5. A separately configured settlement operator verifies the finalised V4
   result and submits the unique Arc `PaymentSettled` event.
6. V4 independently consumes that settlement event before creating a reusable
   TrustPass record.

The settlement operator is a bounded operational trust assumption, not a
permissionless bridge. If settlement is not acknowledged before the 72-hour
escrow deadline, anyone may call the Arc refund route and the original payer
receives the funds. A refunded assessment cannot become consumable.

## Google and Human Passport

Google uses server-side OIDC authorization code flow, state, PKCE, nonce,
issuer/audience/signature/`email_verified`/time checks and a Worker-held
versioned HMAC commitment of the stable Google `sub`. Raw email, `sub`, OAuth
tokens and client secrets never enter GenLayer storage. Live Google linking is
`BLOCKED_EXTERNAL_CREDENTIALS` until a real Google Cloud client and Worker
secrets are configured.

Human Passport reads the actual Optimism Sepolia decoder
`0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56` on chain `11155420`, at a pinned
block, using `getScore(address)` selector `0xd47875d0`. The raw value is
scaled by 10,000: policy threshold 20 is raw `200000`; `199999` fails and
`200000` passes. The decoder does not expose an original issuance timestamp,
so the implementation records block timestamp plus observation time and uses
a seven-day snapshot window and seven-day TrustPass lifetime. This is a
bounded freshness policy, not a claim that the decoder proves original stamp
issuance time.

## Evidence status

## Release deployment record

The engineering release is deployed without changing the accepted V3
authority:

| Network | Component | Address | Result |
|---|---|---|---|
| GenLayer Studionet `61999` | V4 TrustPass contract | `0xcdec5d1bE08456dF05BBCe4c0A34A6AB5c71dCF2` | `FINALIZED / MAJORITY_AGREE / FINISHED_WITH_RETURN / SUCCESS` |
| Arc Testnet `5042002` | USDC escrow | `0x847269d045a0e0c6fad1fedb155d3a1dfc6936df` | deployment and configuration confirmed successful |
| Cloudflare Workers | Discord/Google issuer | `https://soulstamp-discord.delealufejoel.workers.dev` | Discord health confirmed; Google credentials not configured |

Vercel is also released and served:

| Environment | Deployment | Status | Served bundle |
|---|---|---|---|
| Production | [`dpl_2oNQ9ByHEPNhnWhBrKDPYvWb9BKo`](https://vercel.com/delealufejoel-4184s-projects/soulstamp/2oNQ9ByHEPNhnWhBrKDPYvWb9BKo) | `READY`, aliased to [soulstamp-gen.vercel.app](https://soulstamp-gen.vercel.app) | V3, V4, Arc escrow and Worker URL confirmed |
| Preview | [`dpl_GWb2EW3SQMBvs2HLTCEXPG5PLWhw`](https://vercel.com/delealufejoel-4184s-projects/soulstamp/GWb2EW3SQMBvs2HLTCEXPG5PLWhw) | `READY` | V3, V4, Arc escrow and Worker URL confirmed |

Deployment evidence is preserved at
[`artifacts/live/v4-deployment.json`](./artifacts/live/v4-deployment.json).
The V4 source hash is
`7103dc6aa43b196ebe78aaa32eb0e12881ff0d24388652bd20a29766efbf18e3`; the
Arc escrow source hash is
`4ae5673fc4a0788a7d5d356e5043dae87e82120642b1c1d92a00a00c3f1589d6`.

Explorer records:

- [GenLayer V4 deployment](https://explorer-studio.genlayer.com/tx/0xb16bbf2cc1bed529577c3232cd48c260da7c5065b6fd7524b868f721288c0b05)
- [Arc escrow deployment](https://explorer.testnet.arc.io/tx/0x86ba6ad19cb591cf8d876207bbb138dace8f9b713ef0e02f80db85becab9b819)
- [Arc V4 binding](https://explorer.testnet.arc.io/tx/0xd0dafa54ce01a6af3a25c87ad2cbdd3e5058494167ccbb37f65c314a18dd9242)

No Arc deposit, assessment, settlement, refund, Google account link, or
Human Passport positive-subject transaction is recorded as live evidence yet.
Those records remain `untested` or `blocked_external_credentials` rather than
being inferred from local tests.

The release ledger in `artifacts/live/v4-deployment.json` distinguishes
`confirmed_success`, `confirmed_failed`, `pending`, `blocked_external_credentials`,
`local_only` and `untested`. Empty transaction fields mean no transaction has
been observed; they are never placeholders for invented live evidence.

Before release, a live record must include the finalized receipt, majority
consensus, successful authoritative execution, post-state and normalized
source hash for each deployed contract. A real positive Google flow,
Human-Passport positive subject and paid end-to-end assessment require
user-controlled external credentials/evidence and are not replaced by mocks.

## Gates

```text
python scripts/contract_gates.py
python -m pytest tests -q
npm run test:frontend
npm run test:finality
npm --prefix backend test
forge fmt --check && forge build && forge test
npm --prefix frontend run build
npm audit --audit-level=high
```

The repository-local GenLayer CLI is pinned to `0.39.1`; semantic validation
uses GenVM runner bundle `v0.2.16` with the repository's GenVM linter `0.11.0`.
Foundry uses Solidity `0.8.24`.
