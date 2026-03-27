# Configuration

## Required

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `ISSUER_PRIVATE_KEY` | Base58 private key used for wallet approvals and transfers |

## Compliance

| Variable | Default | Description |
| --- | --- | --- |
| `RANGE_API_KEY` | unset | Enables real Range screening; unset means mock mode |
| `RANGE_API_URL` | `https://api.range.org/v1` | Override Range base URL |
| `RANGE_RISK_THRESHOLD` | `6` | Reject scores at or above this value on the 1-10 scale |

## HTTP server

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind host |
| `PORT` | `3000` | Bind port |
| `CORS_ALLOWED_ORIGINS` | localhost values | Comma-separated allowed origins |

## Rate limiting

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_RATE_LIMITING` | `false` | Enables governor middleware |
| `RATE_LIMIT_RPS` | `10` | Requests per second per IP |
| `RATE_LIMIT_BURST` | `20` | Burst allowance |

## Worker and retries

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_BACKGROUND_WORKER` | `true` | Enables the queue worker |
| `ENABLE_STALE_CRANK` | `true` | Poll fallback for submitted transfers |
| `CRANK_POLL_INTERVAL_SECS` | `60` | How often the crank scans for stale submissions |
| `CRANK_STALE_AFTER_SECS` | `90` | Submitted-for-too-long cutoff |
| `CRANK_BATCH_SIZE` | `20` | Maximum stale items per cycle |

## Jito / QuickNode

| Variable | Default | Description |
| --- | --- | --- |
| `USE_JITO_BUNDLES` | `false` | Enables private Jito submission when the provider is QuickNode |
| `JITO_TIP_LAMPORTS` | `10000` | Tip appended to bundled transactions |
| `JITO_REGION` | unset | Optional QuickNode Jito region |

## Webhook auth

| Variable | Description |
| --- | --- |
| `HELIUS_WEBHOOK_SECRET` | Expected Authorization header for Helius webhooks |
| `QUICKNODE_WEBHOOK_SECRET` | Expected secret for QuickNode webhooks |

## Logging

| Variable | Default | Description |
| --- | --- | --- |
| `RUST_LOG` | `info,tower_http=debug,sqlx=warn` | Rust tracing filter |

## Notes

- `token_mint` is required by the Fortis relay path.
- Range screening is wallet-centric. The backend screens the receiver wallet, not a transfer proof bundle.
- The worker processes wallet approvals before transfer relay so the on-chain approval exists before the Token-2022 transfer is sent.
