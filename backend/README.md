# Solana Compliance Relayer Backend

This backend now targets the Fortis RWA flow:

1. Receive a signed public Token-2022 transfer request.
2. Screen the receiver wallet with blocklist, Range, and optional Helius DAS checks.
3. Persist a wallet-approval job keyed by `(wallet_address, token_mint)`.
4. Let the worker submit `approve_wallet` to `programs/rwa_tokenizer`.
5. Relay the public Token-2022 transfer only after the wallet approval is confirmed.
6. Track confirmation through webhooks and the stale-transaction crank.

## What it keeps

- Public Token-2022 transfer outbox pattern
- Jito bundle submission and retry safety
- Helius DAS checks and webhook reliability
- PostgreSQL persistence, idempotency, and replay protection

## What it removes

- Confidential-transfer proof payloads
- QuickNode privacy health checks
- ZK proof generation / relay code paths

## Quick start

```bash
cd backend
cargo check
cargo sqlx migrate run
cargo run
```

The API listens on `http://localhost:3000` by default.

## Core request shape

```json
{
  "from_address": "SenderPubkey",
  "to_address": "ReceiverPubkey",
  "transfer_details": {
    "type": "public",
    "amount": 1000000
  },
  "token_mint": "Token2022MintPubkey",
  "signature": "Base58Ed25519Signature",
  "nonce": "019470a4-7e7c-7d3e-8f1a-2b3c4d5e6f7a"
}
```

Signing format:

```text
{from_address}:{to_address}:{amount}:{token_mint}:{nonce}
```

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/API_REFERENCE.md`
- `docs/CLIENT_INTEGRATION.md`
- `docs/CONFIGURATION.md`
- `docs/OPERATIONS.md`
- `docs/SECURITY.md`
