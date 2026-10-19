# V4 operations and release checklist

1. Run `npm ci`, `npm ci --prefix frontend`, `npm ci --prefix backend`,
   `python -m pip install -r requirements-dev.txt`, and install Foundry.
2. Run contract lint/semantic validation, Direct Mode, Worker/frontend tests,
   Foundry tests, production build and the dependency audit.
3. Confirm the deployer address only; never print or log a private key.
4. Confirm Arc chain `5042002`, USDC code and six-decimal interface.
5. Deploy escrow with zero V4, deploy V4 on Studionet `61999`, configure the
   escrow once, and independently verify every finalized receipt/post-state.
6. Configure Vercel public addresses only after both deployed addresses pass
   source/constructor checks. Never send a private key to Vercel. The current
   public V4 and Arc addresses are `0xcdec5d1bE08456dF05BBCe4c0A34A6AB5c71dCF2`
   and `0x847269d045a0e0c6fad1fedb155d3a1dfc6936df` respectively; record READY
   deployment IDs and served-bundle hashes only after an authenticated Vercel
   release.
7. Deploy the Worker only with preserved Discord secrets. Set Google client
   ID publicly and Google client/commitment/session secrets through Wrangler.
8. Test a real consenting subject, real Arc deposit, V4 receipt consumption,
   assessment, settlement, consumer eligibility, a completed negative result,
   and a timeout refund. Keep the transaction hashes in `artifacts/live`.

Current release facts:

- GenLayer V4 deployment:
  [0xb16bbf2cc1bed529577c3232cd48c260da7c5065b6fd7524b868f721288c0b05](https://explorer-studio.genlayer.com/tx/0xb16bbf2cc1bed529577c3232cd48c260da7c5065b6fd7524b868f721288c0b05)
  is finalized with majority agreement, successful authoritative execution,
  and exact LF-normalized source parity.
- Arc escrow deployment:
  [0x86ba6ad19cb591cf8d876207bbb138dace8f9b713ef0e02f80db85becab9b819](https://explorer.testnet.arc.io/tx/0x86ba6ad19cb591cf8d876207bbb138dace8f9b713ef0e02f80db85becab9b819).
- Arc binding:
  [0xd0dafa54ce01a6af3a25c87ad2cbdd3e5058494167ccbb37f65c314a18dd9242](https://explorer.testnet.arc.io/tx/0xd0dafa54ce01a6af3a25c87ad2cbdd3e5058494167ccbb37f65c314a18dd9242).
- Discord Worker health is confirmed at the existing URL. Google remains
  disabled until the user supplies a genuine Google Cloud client and Worker
  secrets; local OIDC tests do not count as live verification.
- Vercel Production is READY at deployment
  `dpl_2oNQ9ByHEPNhnWhBrKDPYvWb9BKo` and Preview is READY at
  `dpl_GWb2EW3SQMBvs2HLTCEXPG5PLWhw`. The public Production alias and Preview
  bundle were fetched through the authenticated Vercel CLI and contain the
  V3 address, V4 address, Arc escrow address, and Worker URL.

The live ledger must mark missing user-controlled Google, Passport, social,
wallet-signature, payment and settlement actions as blocked or untested. A
finalized transaction with an unsuccessful authoritative execution is not a
successful proof.
