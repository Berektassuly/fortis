# Operations

## Queue order

The worker processes the Fortis flow in this order:

1. Claim pending wallet approvals from `wallet_approvals`
2. Submit `approve_wallet` for each queued wallet
3. Claim pending transfer submissions from `transfer_requests`
4. Relay the public Token-2022 transfer once the wallet approval is already marked `approved`

## Persistence model

- `transfer_requests` stores request lifecycle, replay-protection data, transfer retry state, and frozen compliance evidence.
- `wallet_approvals` stores per-wallet approval jobs keyed by `(wallet_address, token_mint)`.

## Confirmation sources

- Helius webhook
- QuickNode webhook
- Stale transaction crank fallback

## Day-2 checks

- Watch for `wallet_approvals.anchor_status = failed`
- Watch for `transfer_requests.blockchain_status = failed` or `expired`
- Confirm webhook secrets are set in production
- Confirm Jito bundles are only enabled when QuickNode Jito support is available

## Useful commands

```bash
cd backend
cargo check
cargo check --tests
cargo sqlx migrate run
cargo run
```

## Troubleshooting

| Symptom | Likely cause | What to inspect |
| --- | --- | --- |
| Transfer stays `received` | Worker disabled | `ENABLE_BACKGROUND_WORKER` and logs |
| Wallet approval stays `processing` | RPC failure or retry backoff | `wallet_approvals.last_error`, `next_retry_at` |
| Transfer never relays after approval | Approval row not marked `approved` | `wallet_approvals.anchor_status` |
| Request rejected immediately | Blocklist or Range rejection | `range_risk_*` fields and blocklist tables |
| Jito requested but not used | Non-QuickNode RPC | startup logs and `SOLANA_RPC_URL` |
