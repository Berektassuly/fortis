# Client Integration

## Signing format

Every client must sign this exact UTF-8 message:

```text
{from_address}:{to_address}:{amount}:{token_mint}:{nonce}
```

Example:

```text
7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU:DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy:1000000:Token2022MintPubkey:019470a4-7e7c-7d3e-8f1a-2b3c4d5e6f7a
```

## Request shape

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

## Expected server flow

1. The backend persists the request immediately.
2. The receiver wallet is screened.
3. A wallet-approval job is enqueued for `(token_mint, to_address)`.
4. The background worker submits `approve_wallet` to the Fortis Anchor program.
5. The transfer relay is submitted only after the approval exists.

## Local generator

Use the public-only helper:

```bash
cd backend
cargo run --bin generate_transfer_request -- --mint <MINT> --to <WALLET> --amount <RAW_UNITS>
```

## Common mistakes

- Omitting `token_mint`
- Signing a different nonce than the one sent in JSON
- Using a decimal UI amount instead of raw token units
- Changing request fields after signing
