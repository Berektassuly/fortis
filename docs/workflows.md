# Fortis Workflows

## Overview

This document focuses on the real workflow boundaries in the current repo:

- Listing tokenization
- Buyer-initiated transfer orchestration
- Wallet approval creation
- Transaction reconciliation and order status updates

It is the best place to start if you understand the architecture at a high level and want to follow the actual product flow end to end.

## Workflow 1: Listing Tokenization

The listing tokenization path turns a marketplace listing into a Token-2022 asset that Fortis can enforce.

### Step-by-step

1. The seller creates a listing through the marketplace.
2. `marketplace-api/lib/services/listings.ts` inserts the listing into Supabase with `tokenization_status = "tokenizing"`.
3. The marketplace calls the backend `POST /listings/tokenize` endpoint.
4. The backend builds the on-chain asset:
   - creates a Token-2022 mint
   - attaches the Fortis transfer hook
   - initializes the extra account meta list
   - initializes the `AssetRecord`
   - approves the seller wallet
   - approves the Fortis delegate wallet
   - mints the planned supply to the seller
5. The backend returns:
   - `token_mint_address`
   - `asset_record_pda`
   - `seller_compliance_record_pda`
   - `delegate_wallet_address`
   - setup transaction signatures
6. The marketplace updates the listing in Supabase:
   - `token_mint_address`
   - `tokenization_status = "active"`
   - clears any tokenization error

### Why seller and delegate approvals happen here

The minted asset starts in the seller's token account, and the backend may later act through the Fortis delegate path to move that token during an approved purchase. Approving those wallets during tokenization avoids a later sender-side compliance gap.

## Workflow 2: Buyer-Initiated Transfer Request

The transfer flow in this repo is not a generic peer-to-peer transfer UI. It is a marketplace purchase flow with a specific signed-intent model.

### Important detail

In the current marketplace flow, the signed intent proves the buyer wallet and nonce. The marketplace currently passes the buyer wallet as both `from_address` and `to_address`, while `source_owner_address` points at the seller wallet that still holds the tokenized asset. That allows the backend to relay the seller-side Token-2022 transfer after the buyer has been screened and approved.

### Step-by-step

1. The buyer signs a transfer intent in the marketplace.
2. The marketplace verifies the signature locally before calling Fortis.
3. The marketplace inserts an `orders` row in Supabase with status `Pending`.
4. The marketplace sends `POST /transfer-requests` to the backend with:
   - `from_address`
   - `to_address`
   - `source_owner_address`
   - `token_mint`
   - `transfer_details`
   - `signature`
   - `nonce`
5. The backend validates the request and verifies the Ed25519 signature against the message format:
   - `{from_address}:{to_address}:{amount}:{token_mint}:{nonce}`
6. The backend checks `(from_address, nonce)` for idempotency.
7. The backend persists the transfer request immediately with lifecycle state before any external screening occurs.

### Why persist first

Fortis uses a receive, persist, process model so the audit trail survives partial failures. If screening fails or the backend crashes mid-flow, the request still exists in durable state.

## Workflow 3: Compliance Screening and Wallet Approval

After the request is persisted, the backend decides whether the destination wallet can participate in the asset's transfer path.

### Screening path

The backend screens the wallet using:

- The internal `blocklist`
- The configured Range provider
- Helius DAS asset checks through the risk service path

The backend also caches risk profiles in `wallet_risk_profiles`.

### Approval path

If screening passes:

1. The backend derives the mint-level `AssetRecord` PDA and wallet-level `ComplianceRecord` PDA.
2. The backend upserts a `wallet_approvals` row for `(token_mint, wallet)`.
3. The transfer request is marked approved and moved to `pending_submission`.
4. The background worker picks up pending wallet approvals.
5. The worker submits `approve_wallet` on the `rwa_tokenizer` program.
6. Once the approval exists on chain, the worker can submit the transfer relay.

If screening fails:

- The transfer request is marked rejected or failed.
- High-risk addresses may also be auto-added to the internal blocklist.

## Workflow 4: On-chain Transfer Enforcement

The transfer relay only succeeds if the on-chain state matches the backend's expectations.

### What the backend submits

The backend uses Token-2022 transfer instructions and resolves the Fortis extra accounts needed by the transfer hook.

### What the program enforces

During transfer execution:

1. Token-2022 calls the Fortis transfer hook.
2. The hook resolves:
   - the mint's `AssetRecord`
   - the sender `ComplianceRecord`
   - the receiver `ComplianceRecord`
3. The hook rejects the transfer if:
   - a required PDA is missing
   - a wallet has been revoked
   - the PDA does not match the expected mint and wallet

This is the core enforcement guarantee of Fortis: off-chain logic can approve or queue state, but the actual transfer still fails if the required on-chain approvals are not present.

## Workflow 5: Transaction Reconciliation

Fortis treats transaction submission and transaction confirmation as separate problems.

### Submission lifecycle

A request typically moves through these states:

- `received`
- `pending_submission`
- `processing`
- `submitted`
- `confirmed`

Failure states include:

- `failed`
- `expired`

### Confirmation sources

The backend reconciles transaction status through:

- Helius webhooks
- QuickNode webhooks
- The stale-transaction crank

### Why the stale crank exists

Provider webhooks can be delayed, dropped, or malformed. The crank polls transfers stuck in `submitted` longer than the configured threshold and checks whether they:

- actually confirmed on chain
- failed on chain
- never landed and are now past blockhash validity

That is how Fortis avoids leaving orders permanently stuck just because a callback was missed.

## Workflow 6: Marketplace Order Status Updates

The marketplace does not currently depend on backend-originated callbacks for the normal happy path.

### Current behavior in this repo

1. When the buyer fetches an order, the marketplace loads the Supabase order.
2. If the order has a `fortis_request_id` and is not terminal yet, the marketplace calls Fortis to refresh the transfer request.
3. `marketplace-api/lib/services/order-updates.ts` maps backend status into marketplace status:
   - `received` or `pending` -> `Pending`
   - `pending_submission`, `processing`, `submitted` -> `Processing`
   - `confirmed` or `finalized` -> `Success`
   - `failed`, `expired`, or `rejected` -> `Failed`
4. The mapped order status is written back to Supabase.

### Internal webhook route

The marketplace also exposes `app/api/internal/webhooks/fortis-success/route.ts`, which verifies an HMAC signature before updating orders. That route is available for push-based updates, but there is no backend-side sender for it inside this repo today.

## Suggested Files To Read With These Flows

- `marketplace-api/lib/services/listings.ts`
- `marketplace-api/lib/services/orders.ts`
- `marketplace-api/lib/services/order-updates.ts`
- `backend/src/app/service.rs`
- `backend/src/app/worker.rs`
- `backend/src/infra/blockchain/solana.rs`
- `contracts/programs/rwa_tokenizer/src/lib.rs`
- `contracts/tests/rwa-tokenizer.ts`
