# API Reference

## Base URL

`http://localhost:3000`

## POST /transfer-requests

Creates or reuses a Fortis RWA transfer request.

### Request body

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

### Rules

- `transfer_details.type` must be `public`.
- `amount` must be a positive `u64` encoded as JSON number.
- `token_mint` is required and must be a Base58 Solana pubkey.
- The signature must verify against:

```text
{from_address}:{to_address}:{amount}:{token_mint}:{nonce}
```

### Response body

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "from_address": "SenderPubkey",
  "to_address": "ReceiverPubkey",
  "transfer_details": {
    "type": "public",
    "amount": 1000000
  },
  "token_mint": "Token2022MintPubkey",
  "asset_record_pda": "AssetRecordPda",
  "receiver_compliance_pda": "ComplianceRecordPda",
  "range_risk_score": 2,
  "range_risk_level": "Low risk",
  "range_reasoning": "No material exposure detected",
  "compliance_status": "approved",
  "blockchain_status": "pending_submission",
  "blockchain_signature": null,
  "created_at": "2026-03-28T12:00:00Z",
  "updated_at": "2026-03-28T12:00:00Z"
}
```

## GET /transfer-requests/{id}

Returns a single transfer request.

## GET /transfer-requests

Lists transfer requests with optional `limit` and `cursor` query parameters.

## POST /risk-check

Returns the current wallet-risk view using internal blocklist, Range, and optional Helius DAS checks.

## POST /webhooks/helius
## POST /webhooks/quicknode

Confirmation and crank-support endpoints for external webhook providers.

## Error behavior

| Status | Meaning |
| --- | --- |
| `400` | Validation error |
| `403` | Signature verification failed |
| `404` | Transfer request not found |
| `409` | Duplicate / conflicting persistence state |
| `500` | Internal failure |

## Idempotency

The backend stores the client nonce and will return the existing request when the same nonce is submitted again.
