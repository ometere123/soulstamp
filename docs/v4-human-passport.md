# Human Passport evidence

V4 reads the Optimism Sepolia decoder
`0xe53C60F8069C2f0c3a84F9B3DB5cf56f3100ba56` on chain `11155420` through
`eth_chainId`, `eth_getCode`, `eth_getBlockByNumber` and `eth_call`. The call is
the documented `getScore(address)` selector `0xd47875d0`; the requested wallet
is always the V4 subject wallet and is not supplied as a separate user score.

The raw decoder result uses four decimal places. Therefore:

```text
raw 199999  -> 19.9999 -> threshold 20 not met
raw 200000  -> 20       -> threshold met
raw 200001  -> 20.0001  -> threshold met
```

Validators compare the normalized chain, decoder, subject, pinned block hash,
block timestamp, ABI word and raw score. A wrong chain, decoder, wallet,
malformed response, missing code, reverted call, stale block or RPC
disagreement fails closed. The decoder does not provide an original score
issuance timestamp; V4 records the observation and block timestamps and uses a
seven-day refresh window. Users can refresh through the real decoder read and
the GenLayer `refresh_humanity_evidence` write.

Users without on-chain Passport evidence must use the official onboarding or
test-mode instructions at <https://app.passport.xyz> and the Human Passport
documentation. Test-mode evidence must be labelled as testnet evidence; V4
does not synthesize scores.

## Current read-only audit

At Optimism Sepolia block `50307497` (hash
`0x33d845abf8cf74181cd38fd5d0c56f0533386c95a9f047f02dbd03070386c5ab`), the
decoder had bytecode and the RPC reported chain `11155420`. The exact
`getScore(address)` call reverted with `0x120a2e77` for the deployer, local
test wallets and the two known V3 wallet addresses checked from this
repository. The user’s reported score of 44 is therefore not yet a V4-live
fact: the matching public subject wallet is still required, and a different
wallet’s score must never be substituted.
