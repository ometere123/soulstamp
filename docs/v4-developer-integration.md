# Consumer integration

An external application must check the exact policy and subject immediately
before granting access:

```ts
const result = await v4.readContract({
  address: V4_TRUSTPASS_ADDRESS,
  functionName: "consumer_eligibility",
  args: [subjectWallet, policyId],
});
if (result.eligible === true) grantAccess();
else handleReason(result.reason);
```

`check_trustpass(passId, policyId, subject)` is available when an application
stores a specific assessment ID. `is_eligible(subject, policyId)` is a compact
boolean interface. Consumers must distinguish `NO_ASSESSMENT`,
`ASSESSMENT_NOT_PASS`, `PAYMENT_UNSETTLED`, `ASSESSMENT_EXPIRED`,
`POLICY_NOT_AUTHORIZED`, `V3_IDENTITY_NOT_ELIGIBLE`, Google invalidity,
Human-Passport invalidity/staleness and infrastructure/unavailable states.

The browser is not an authority: user-controlled JSON, a paid boolean, a
front-end score or a wallet assertion must never replace the contract view.
The repository's `frontend/src/lib/trustpass.ts` provides typed read/write
helpers and finality-gated GenLayer writes; `frontend/src/lib/arc.ts` handles
the exact six-decimal Arc payment.

