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
    public V4 and Arc addresses are `0xF3B64cD356D9c67144f77e167ee0D02B3a760a3c`
    and `0x53eeb55fcb5253d6640a5db8c3a7bea9deb9316f` respectively; record READY
    deployment IDs and served-bundle checks only after an authenticated Vercel
   release.
7. Deploy the Worker only with preserved Discord secrets. Set Google client
   ID publicly and Google client/commitment/session secrets through Wrangler.
8. Test a real consenting subject, real Arc deposit, V4 receipt consumption,
   assessment, settlement, consumer eligibility, a completed negative result,
   and a timeout refund. Keep the transaction hashes in `artifacts/live`.

Historical V4.1 release facts are retained in the earlier entries below. The
active corrected V4.2 release facts are:

- GenLayer V4.2 deployment:
  [0x1d08f776c793e13817285d9830074d884c25e3ad30189c774c092bb523a10673](https://explorer-studio.genlayer.com/tx/0x1d08f776c793e13817285d9830074d884c25e3ad30189c774c092bb523a10673)
  is `FINALIZED / MAJORITY_AGREE / FINISHED_WITH_RETURN` with raw
  `SUCCESS/SUCCESS`, exact LF-normalized source parity and source hash
  `fe0b21907b1612f839da126d91a0dd2d7a9ccdb4f021512fa6b89b551f1d09a7`.
- Arc V4.2 escrow deployment:
  [0xebc88901a2f00f459f6e2e5baad0e1ca5a82052a917e452e2b036efe724844f0](https://explorer.testnet.arc.io/tx/0xebc88901a2f00f459f6e2e5baad0e1ca5a82052a917e452e2b036efe724844f0).
- Arc V4.2 binding:
  [0x7fc07c9fbac09cad0df21f6fd8b3e2e2c046f8e21c2d680eda5120695e93b703](https://explorer.testnet.arc.io/tx/0x7fc07c9fbac09cad0df21f6fd8b3e2e2c046f8e21c2d680eda5120695e93b703).
- Discord Worker health is confirmed at the existing URL, and `/health`
  reports Google configured with the exact callback. A real Google account
  login/link is still not claimed; local OIDC tests do not count as live
  verification.
- Vercel Production is READY at deployment
  `dpl_DEpMTuf2gxN6FzdRBS52RWSNUgjR` and Preview is READY at
  `dpl_5ansqaEkxLF1gnemp8FHvpfL7gsB`. The public Production alias and
  authenticated Preview bundle were fetched through the Vercel CLI and
  contain the current V3 address, active V4 address, active Arc escrow
  address and Worker URL; the superseded V4/Arc addresses are absent.
- Both Vercel targets currently set `VITE_GOOGLE_WORKER_URL` and
  `VITE_DISCORD_BACKEND_URL` to
  `https://soulstamp-discord.delealufejoel.workers.dev`. The Worker health
  response confirms both providers are configured. Its exact Google callback
  is `/api/google/callback`; its Discord callback remains
  `/api/discord/callback`.

The superseded V4.2 ABI-defective release remains historical at GenLayer
`0xFdb126147cE5DFD9Cb461079d77cae5803E7E7F2` with Arc escrow
`0x686f8ab8ce08512af72ab26c78a98a23ea8b71be`; its deployment and binding
transactions remain in the earlier evidence records.

The live ledger must mark missing user-controlled Google, Passport, social,
wallet-signature, payment and settlement actions as blocked or untested. A
finalized transaction with an unsuccessful authoritative execution is not a
successful proof.

## Unified Passport compatibility and existing escrow refund

The previous V4.1 deployment remains the historical release at
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
4. Only then call `confirm_arc_refund(requestId, refundTxHash, logIndex)` on the
   historical V4.1 contract
   `0x886582aB1a45452880685b6a50c748cAb7c954ce`, because that request and its
   escrow are bound to that pair. Wait for `FINALIZED`, `MAJORITY_AGREE`, and
   successful GenVM execution; do not send this confirmation to V4.2.
5. Read `get_request(requestId)` and confirm `state=REFUNDED` and
   `payment_state=REFUNDED`. No assessment or settlement transaction belongs
   to this request.

`scripts/refund-v4-payment.mjs` contains the authenticated payer flow, but it
must not be run before the deadline. It requires the historical V4 address,
historical escrow address, and expected original payer explicitly on the command
line, so a current `.env` address cannot silently redirect the refund. For this
request the guarded command is:

```text
node scripts/refund-v4-payment.mjs 9FE94A1BD40CD33197241D5B780B2C448064C0C0C4BF34FF75026170D461CC7F 0x9a953df7ccd34a7db3f52a97d77ac0681038ec53b1c28f16009c6282573875d5 0x886582aB1a45452880685b6a50c748cAb7c954ce 0xe2a0118847cbf424dbd6f5761987624ea7aae72e 0xFd69A5D0b8330dC86e266304B3D1ABE3F57b9D09
```

Before any write it reads the historical V4 request/intent, confirms the exact
escrow binding and payer, reads the Arc payment record, confirms the original
payer signer and only then calls `refund`. The frontend refund flow uses the same on-chain state and
must not display a 1970 date when no escrow exists. If an old Arc log query is
pruned, the stored V4 transaction/log/block reference is used first; a bounded
recent log scan is only a fallback. Refund itself uses the transaction receipt
and does not require a block-zero history query.

Making this historical request assessable with the active unified attestation
cannot reuse its old payment: the old V4 and escrow remain a separate pair.
The active corrected V4.2 is
`0xF3B64cD356D9c67144f77e167ee0D02B3a760a3c` with escrow
`0x53eeb55fcb5253d6640a5db8c3a7bea9deb9316f`; the existing EAS attestation can
be reused as evidence for a new request, but the old escrow deposit cannot be
reused as payment. Refund the old request only after its documented deadline.

## Automatic Passport discovery operations

The existing Worker is also the server-side Human Passport discovery boundary.
Configure `PASSPORT_API_KEY` and `PASSPORT_SCORER_ID` as Worker secrets; never
put either value in a Vite variable. `PASSPORT_GRAPHQL_URL` is a fixed
allowlisted Optimism Sepolia EASSCAN endpoint. Discovery is rate-limited,
bounded and returns only sanitized API summaries and EAS candidates. A
candidate is not evidence: the frontend must call the direct EAS validator and
the user must submit `refresh_humanity_evidence_unified` for the exact funded
request. After finality, read `get_humanity_evidence` and compare both wallet
and UID before displaying verified state.

The public route is:

```text
GET https://soulstamp-discord.delealufejoel.workers.dev/api/passport/discover?wallet=0x...
```

The current production health check reports Discord and Google configured,
Passport configured, API scorer `12174`, approved on-chain scorer `335`, and the
operational indexer endpoint. The known wallet's live indexer candidate and
independent EAS facts are recorded in the automatic discovery evidence ledger.
