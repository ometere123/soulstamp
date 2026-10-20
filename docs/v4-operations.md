# V4 operations and release checklist

1. Run `npm ci`, `npm ci --prefix frontend`, `npm ci --prefix backend`,
   `python -m pip install -r requirements-dev.txt`, and install Foundry.
2. Run contract lint/semantic validation, Direct Mode, Worker/frontend tests,
   Foundry tests, production build and the runtime dependency audits. The
   full development-tool audit is retained as an advisory report because the
   GenLayer CLI is pinned to `0.39.1`.
3. Confirm the deployer address only; never print or log a private key.
4. Confirm Arc chain `5042002`, USDC code and six-decimal interface.
5. Deploy escrow with zero V4, deploy V4 on Studionet `61999`, configure the
   escrow once, and independently verify every finalized receipt/post-state.
6. Configure Vercel public addresses only after both deployed addresses pass
    source/constructor checks. Never send a private key to Vercel. The current
    public V4 and Arc addresses are `0x886582aB1a45452880685b6a50c748cAb7c954ce`
    and `0xe2a0118847cbf424dbd6f5761987624ea7aae72e` respectively; record READY
    deployment IDs and served-bundle checks only after an authenticated Vercel
   release.
7. Deploy the Worker only with preserved Discord secrets. Set Google client
   ID publicly and Google client/commitment/session secrets through Wrangler.
8. Test a real consenting subject, real Arc deposit, V4 receipt consumption,
   assessment, settlement, consumer eligibility, a completed negative result,
   and a timeout refund. Keep the transaction hashes in `artifacts/live`.

Current release facts:

- GenLayer V4 deployment:
  [0xe7ecb0b579ac2906b08dbd0fd30a5e5f0c0efe8b1cf610f09a97e182393a0ae4](https://explorer-studio.genlayer.com/tx/0xe7ecb0b579ac2906b08dbd0fd30a5e5f0c0efe8b1cf610f09a97e182393a0ae4)
  is finalized with majority agreement, successful authoritative execution,
  exact LF-normalized source parity and source hash
  `c4e30170872e629aa0cdda2693f971d3f476919a19f873936a0a1b4972e61c7d`.
- Arc escrow deployment:
  [0xeafe5a97d114d6fd120ca1ec05ea9cb38c3e6fecd95b92c57d6402ebe7a5eb6e](https://explorer.testnet.arc.io/tx/0xeafe5a97d114d6fd120ca1ec05ea9cb38c3e6fecd95b92c57d6402ebe7a5eb6e).
- Arc binding:
  [0x130bce4836aba2f3ca70f390983d48320e03fe5448a9d059a9df9ff982b493e6](https://explorer.testnet.arc.io/tx/0x130bce4836aba2f3ca70f390983d48320e03fe5448a9d059a9df9ff982b493e6).
- Discord Worker health is confirmed at the existing URL, and `/health`
  reports Google configured with the exact callback. A real Google account
  login/link is still not claimed; local OIDC tests do not count as live
  verification.
- Vercel Production is READY at deployment
  `dpl_H2r1eNtf1g6i4CSf8qXxQzbTQtsU` and Preview is READY at
  `dpl_5HGg2qznpThXrjSVGFNyor4xvPxn`. The public Production alias and
  authenticated Preview bundle were fetched through the Vercel CLI and
  contain the current V3 address, current V4 address, current Arc escrow
  address, Worker URL, and Google callback handoff code; the legacy Cloud
  Function URL is absent.
- Both Vercel targets currently set `VITE_GOOGLE_WORKER_URL` and
  `VITE_DISCORD_BACKEND_URL` to
  `https://soulstamp-discord.delealufejoel.workers.dev`. The Worker health
  response confirms both providers are configured. Its exact Google callback
  is `/api/google/callback`; its Discord callback remains
  `/api/discord/callback`.

The live ledger must mark missing user-controlled Google, Passport, social,
wallet-signature, payment and settlement actions as blocked or untested. A
finalized transaction with an unsuccessful authoritative execution is not a
successful proof.

## Unified Passport compatibility and existing escrow refund

The current V4 deployment remains the historical release at
`0x886582aB1a45452880685b6a50c748cAb7c954ce`, paired with Arc escrow
`0xe2a0118847cbf424dbd6f5761987624ea7aae72e`. The current subject’s valid
unified EAS attestation is recorded in
`artifacts/live/v4-unified-passport-readiness.json`, but the deployed V4 only
contains the legacy Passport decoder path. Do not submit `evaluate_assessment`
or settlement for its funded Sybil request.

The exact funded request is
`9FE94A1BD40CD33197241D5B780B2C448064C0C0C4BF34FF75026170D461CC7F`, with
Arc request key
`0x9a953df7ccd34a7db3f52a97d77ac0681038ec53b1c28f16009c6282573875d5`,
deposit transaction
`0x9032dccd6d089ebb0491cb6195265f7b7cad009910b22ac3785ca669329b51648`,
and original payer/subject
`0xFd69A5D0b8330dC86e266304B3D1ABE3F57b9D09`. The authoritative Arc
`depositedAt` is `2026-10-19T23:03:49Z`; `depositedAt + 72 hours` makes the
refund eligible at `2026-10-22T23:03:49Z`. The V4 request’s stored display
time is four seconds later because it was recorded during confirmation; the
Arc escrow timestamp is authoritative.

Do not run the refund before that deadline. When eligible, use the following
read/verify sequence:

1. On Arc Testnet, read `getPayment(requestKey)` from the existing escrow and
   confirm the exact request key, original payer, amount `1000000`, and
   `status=ESCROWED`.
2. Call `refund(requestKey)` on the existing escrow. It is permissionless, but
   the escrow always transfers the funds to the payer stored in the record; it
   does not accept a caller-selected recipient.
3. Verify a successful Arc receipt containing one `PaymentRefunded` event from
   the existing escrow and read `getPayment(requestKey)` again to confirm
   `status=REFUNDED`.
4. Only then call the current V4
   `confirm_arc_refund(requestId, refundTxHash, logIndex)` and wait for
   `FINALIZED`, `MAJORITY_AGREE`, and successful GenVM execution.
5. Read `get_request(requestId)` and confirm `state=REFUNDED` and
   `payment_state=REFUNDED`. No assessment or settlement transaction belongs
   to this request.

`scripts/refund-v4-payment.mjs` contains the authenticated operator flow, but
it must not be run before the deadline and its environment must point to the
old V4/escrow pair. The frontend refund flow uses the same on-chain state and
must not display a 1970 date when no escrow exists. If an old Arc log query is
pruned, the stored V4 transaction/log/block reference is used first; a bounded
recent log scan is only a fallback. Refund itself uses the transaction receipt
and does not require a block-zero history query.

Making this request assessable with the unified attestation cannot be done by
changing the frontend: the current V4 has no unified-EAS write method, and the
old escrow is bound to the old V4 address. After the old deposit is refunded,
the minimum compatible path is an explicitly approved new V4 deployment, a
fresh Arc escrow bound to that new address, a new request, and a new payment.
The existing EAS attestation can be reused as evidence; the old escrow deposit
cannot be reused as payment.
