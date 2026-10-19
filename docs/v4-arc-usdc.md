# V4 Arc USDC operations

Network: Arc Testnet, chain `5042002`, RPC `https://rpc.testnet.arc.io`.
Explorer: `https://explorer.testnet.arc.io`. USDC is the Arc predeploy
`0x3600000000000000000000000000000000000000`, with six ERC-20 decimals.

The escrow uses exact integer accounting and a fixed testnet price of
`1000000`. It separates active escrow liabilities from settled revenue and
uses safe low-level ERC-20 transfers, reentrancy protection, role-separated
admin/treasury/operator handovers, pause, one-time V4 binding, timeout refunds
and one-way settlement.

Deployment ordering:

1. `forge build` and run `node scripts/deploy-arc-v4.mjs`.
2. Deploy V4 with the returned escrow address using
   `node scripts/deploy-trustpass-v4.mjs`.
3. Set `ARC_ESCROW_ADDRESS` and `V4_TRUSTPASS_CONTRACT_ADDRESS`, then run
   `node scripts/configure-arc-v4.mjs`.
4. Read `genlayerV4`, `admin`, `treasury`, `settlementOperator`, `price`, and
   `liabilitiesSolvent` again.

`scripts/settle-v4-payment.mjs` only submits settlement after it has verified
the GenLayer receipt is `FINALIZED + MAJORITY_AGREE + FINISHED_WITH_RETURN`,
the expected request post-state, and the exact Arc escrow payment. The refund
script is permissionless at the contract level but still verifies the payment
state before submitting.

