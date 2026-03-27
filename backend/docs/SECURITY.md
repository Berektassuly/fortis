# Security

## Replay protection

Each request includes a client nonce and signature. The backend verifies the signature against:

```text
{from_address}:{to_address}:{amount}:{token_mint}:{nonce}
```

This prevents replaying an old signed transfer under a new request id.

## Wallet-centric compliance

The backend no longer accepts confidential proof payloads. Instead, it makes a wallet decision first:

- Internal blocklist check
- Range Protocol risk score / reasoning
- Optional Helius DAS asset screening

The resulting Range snapshot is frozen onto the transfer and wallet-approval records.

## On-chain approval path

Wallet approvals are submitted as normal instructions to the Fortis Anchor program in `programs/rwa_tokenizer/src/lib.rs`.

- Instruction: `approve_wallet`
- Asset PDA seeds: `["asset", mint]`
- Compliance PDA seeds: `["compliance", mint, wallet]`

## Transfer safety

- Transfers require a Token-2022 mint
- Jito retry logic is preserved for relay submission
- Webhooks plus the stale crank protect against dropped confirmations
- Wallet approvals are unique per `(wallet_address, token_mint)` to avoid duplicate approval spam
