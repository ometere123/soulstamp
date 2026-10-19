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
  `dpl_FdroVijWYAuXcdQUVCSMFYDsgieo` and Preview is READY at
  `dpl_7ES4pP6ZwzjUjWs89YgoqQjyA7SR`. The public Production alias and Preview
  bundle were fetched through the authenticated Vercel CLI and contain the
  current V3 address, current V4 address, current Arc escrow address, and
  Worker URL; the superseded V4/Arc literals are absent.

The live ledger must mark missing user-controlled Google, Passport, social,
wallet-signature, payment and settlement actions as blocked or untested. A
finalized transaction with an unsuccessful authoritative execution is not a
successful proof.
