# Fortis

Fortis is a Solana monorepo for compliant real-world asset tokenization and transfer orchestration. It pairs a Rust control plane with a Token-2022 transfer-hook program so wallet screening, approvals, and transfer execution stay auditable end to end.

**Problem statement:** Fortis solves the gap between regulated asset transfers and public token movement by making each transfer depend on wallet-level compliance approvals that are enforced on chain.

## Why Solana

Other chains can represent tokenized assets, but Solana is the best fit for this workflow because Fortis needs product speed and protocol primitives at the same time:

- Fast confirmation makes marketplace flows feel interactive instead of batch-oriented.
- Low fees make repeated token operations, wallet approvals, and compliance state updates practical.
- Token-2022 and transfer hooks let Fortis enforce transfer policy at the token layer instead of relying only on off-chain coordination.
- The chain is a good fit for a split architecture where off-chain services decide compliance and on-chain code enforces approved state at transfer time.
- Fortis specifically benefits from being able to combine a high-throughput marketplace app with a control plane that may touch compliance state often without making every step expensive.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `backend/` | Rust backend service: Axum API, worker, stale-transaction crank, SQLx/Postgres, wallet screening, wallet approvals, transfer relay logic, and provider webhooks |
| `contracts/` | Anchor workspace for the `rwa_tokenizer` Solana program, integration tests, and helper scripts |
| `contracts/programs/rwa_tokenizer/` | Token-2022 transfer-hook program that stores asset and wallet compliance PDAs and enforces transfer policy |
| `contracts/tests/` | Anchor integration tests for mint setup, approvals, transfer-hook enforcement, and revocation scenarios |
| `contracts/scripts/` | Solana helper scripts such as mint initialization |
| `marketplace-api/` | Next.js marketplace app with listing creation, wallet-first auth, order tracking, and Fortis backend integration |
| `marketplace-api/supabase/` | Marketplace Supabase config and SQL migrations for listings, orders, profiles, and wallet-first SIWS auth |
| `supabase/` | Repo-root Supabase CLI scaffold for local tooling at the monorepo root |
| `.env.example` | Shared root environment template used by the backend |
| `docker-compose.yml` | Local PostgreSQL and backend container setup |

## System Architecture

Fortis is split into an off-chain control plane and an on-chain enforcement layer.

| Layer | Responsibility |
| --- | --- |
| `marketplace-api` | User-facing marketplace UI and API routes, listing creation, order creation, wallet-first auth, webhook bridge back into marketplace order state |
| `Supabase` | Marketplace data model, auth/session handling, profile resolution, and storage-backed listing assets |
| `backend` | Signed intent intake, nonce-based idempotency, screening, wallet approval queueing, blockchain submission, retries, webhook processing, and stale-transaction recovery |
| `PostgreSQL` | Durable backend state for transfer requests, wallet approvals, retries, blocklist state, and cached compliance context |
| `contracts/programs/rwa_tokenizer` | On-chain asset records, per-wallet compliance records, transfer-hook account resolution, and transfer-time enforcement |

### Off-chain vs on-chain split

- Off chain, Fortis decides whether a wallet should be allowed to receive a given token and manages the operational lifecycle needed to get that approval on chain.
- On chain, the `rwa_tokenizer` program does not trust the client or the backend at transfer time. The Token-2022 transfer hook checks the required PDAs and rejects transfers if the sender or receiver is not approved.

## Core Workflows

### 1. Listing tokenization

1. A seller creates a listing through the Next.js marketplace.
2. The marketplace writes the initial listing to Supabase with `tokenization_status = "tokenizing"`.
3. The marketplace calls the backend `POST /listings/tokenize` endpoint.
4. The backend creates the tokenization artifacts on Solana, including the Token-2022 mint setup and Fortis program state needed for enforcement.
5. The backend returns the token mint and PDA metadata.
6. The marketplace stores the mint address in Supabase and marks the listing active.

### 2. Transfer and compliance lifecycle

1. A buyer signs a transfer intent for a public Token-2022 transfer.
2. The marketplace verifies the signed intent, creates an order record, and forwards the request to `POST /transfer-requests`.
3. The backend validates the signature, checks the `(from_address, nonce)` pair for idempotency, and persists the request before any external processing.
4. The backend screens the relevant wallet using the internal blocklist and the configured compliance provider.
5. If screening passes, the backend enqueues a wallet approval for the `(token_mint, wallet)` pair and marks the transfer ready for processing.
6. The background worker submits `approve_wallet` on the `rwa_tokenizer` program, which creates or updates the wallet compliance PDA.
7. After the approval exists on chain, the backend relays the public Token-2022 transfer.
8. During transfer execution, the Token-2022 hook resolves the sender and receiver compliance PDAs and blocks the transfer unless both sides are approved.
9. Confirmation is reconciled through provider webhooks and a stale-transaction crank that polls for transactions stuck in `submitted` state.
10. The marketplace consumes Fortis status updates and keeps the user-facing order state in sync.

## Quick Start

Use this path if you want the repo running locally with the least amount of setup:

1. Install the local dependencies listed in [Environment and Dependencies](#environment-and-dependencies).
2. Copy the root backend template and fill in at least `DATABASE_URL` and `ISSUER_PRIVATE_KEY`:

```bash
cp .env.example .env
```

3. Start the backend database from the repo root:

```bash
docker compose up -d db
```

4. Start the Rust backend:

```bash
cd backend
cargo run
```

5. In a second terminal, start the marketplace app after configuring `marketplace-api/.env.local`:

```bash
cd marketplace-api
npm install
cp .env.example .env.local
npm run dev
```

6. If you are working on the Solana program, build and test the Anchor workspace:

```bash
cd contracts
npm install
anchor build
anchor test
```

The backend defaults to `http://localhost:3000`. If you run the Next.js app locally at the same time, change either the backend port in the root `.env` or the Next.js dev port so they do not collide.

## Backend Development

The backend is the Fortis control plane. It exposes transfer and tokenization endpoints, runs migrations automatically on startup, and starts both the worker and stale-transaction crank when enabled.

### Start locally

```bash
cp .env.example .env
docker compose up -d db
cd backend
cargo run
```

Useful commands:

- `cargo check`
- `cargo test`
- `cargo run --bin generate_transfer_request -- --help`

What to expect:

- The backend loads the repo-root `.env` automatically even when started from `backend/`.
- SQL migrations are applied from `backend/migrations/` at startup.
- Swagger UI is available at `http://localhost:3000/swagger-ui`.
- OpenAPI JSON is available at `http://localhost:3000/api-docs/openapi.json`.

High-level backend environment expectations:

- `DATABASE_URL` must point at a reachable Postgres instance.
- `ISSUER_PRIVATE_KEY` is required and must be a valid Solana keypair secret.
- `SOLANA_RPC_URL` defaults to devnet; point it at your local validator if you want the backend to work against locally deployed contracts.
- `RANGE_API_KEY` is optional. Without it, the backend runs in mock compliance mode.
- Webhook secrets for Helius and QuickNode are optional and only needed if you use those provider callbacks.

## Smart Contract Development

The Solana side lives under `contracts/`. The Anchor workspace contains one program, `rwa_tokenizer`, which enforces transfer compliance using Token-2022 transfer hooks and per-wallet compliance PDAs.

### What the program owns

- `AssetRecord` PDA for mint-level asset metadata
- `ComplianceRecord` PDA for each `(mint, wallet)` approval
- `initialize_extra_account_meta_list` setup for transfer-hook account resolution
- `approve_wallet` and `revoke_wallet` compliance instructions
- Transfer-hook enforcement for sender and receiver approvals

### Start locally

The workspace is configured in `contracts/Anchor.toml` for Anchor `0.32.1` and Solana `3.1.9`.

```bash
cd contracts
npm install
anchor build
anchor test
```

Helpful files:

- `contracts/programs/rwa_tokenizer/src/lib.rs`
- `contracts/tests/rwa-tokenizer.ts`
- `contracts/scripts/initialize-mint.ts`

Notes:

- `anchor test` exercises the full compliance flow, including approval, transfer success, revocation, and transfer failure after revocation.
- If you want the backend to use your local deployment instead of devnet, update the root `.env` so `SOLANA_RPC_URL` matches the Anchor local validator.
- On Windows, WSL2 is usually the most reliable way to work with the Solana SBF toolchain.

## Marketplace Development

`marketplace-api/` is a Next.js app that sits in front of Supabase and Fortis. It handles listing creation, wallet-first authentication, order creation, order polling, and the webhook bridge that updates marketplace order state from Fortis transfer results.

### Start locally

```bash
cd marketplace-api
npm install
cp .env.example .env.local
npm run dev
```

Useful commands:

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm test`

High-level marketplace environment expectations:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are required for browser auth and data access.
- `SUPABASE_SERVICE_ROLE_KEY` is required for privileged webhook and profile-repair flows.
- `FORTIS_ENGINE_URL` must point at the Rust backend.
- `FORTIS_WEBHOOK_SECRET` must match the secret used to sign Fortis webhook callbacks into the marketplace.
- `NEXT_PUBLIC_SOLANA_RPC_URL` is optional and falls back to devnet if omitted.

What the marketplace does today:

- Creates listings and kicks off backend tokenization
- Uses wallet-first SIWS auth patterns with Supabase
- Creates orders from signed transfer intents
- Tracks order state by polling Fortis and applying webhook updates

## Environment and Dependencies

Fortis spans multiple local toolchains. A practical setup includes:

- Rust stable and `cargo`
- Docker and Docker Compose
- Node.js and `npm`
- Solana CLI / Agave SBF toolchain compatible with the Anchor workspace
- Anchor CLI `0.32.1`
- Supabase CLI if you want to run the marketplace auth/data stack locally
- A funded Solana keypair for `ISSUER_PRIVATE_KEY`

A few local environment details matter:

- The backend uses the repo-root `.env` and the Postgres service defined in `docker-compose.yml`.
- The marketplace keeps its own app env in `marketplace-api/.env.local`.
- The backend database and the marketplace Supabase database are separate local systems by default.
- The repo contains both `supabase/` at the root and `marketplace-api/supabase/`. For marketplace schema and auth work, use the config and migrations under `marketplace-api/supabase/`.
- Do not run both Supabase configs on the same machine at the same time unless you have changed the ports, because both default to the same local Supabase ports.

## Where New Contributors Should Look First

If you are new to the repo, start with the files that define the business flow instead of reading every directory:

- `backend/src/api/router.rs` for the public backend surface area
- `backend/src/app/service.rs` for the transfer lifecycle, screening, idempotency, and state transitions
- `backend/src/app/worker.rs` for wallet approval processing and stale-transaction recovery
- `backend/src/domain/types.rs` for request models, transfer types, and the Fortis program ID used by the backend
- `contracts/programs/rwa_tokenizer/src/lib.rs` for the on-chain model and transfer-hook enforcement rules
- `marketplace-api/lib/services/listings.ts` for listing creation and tokenization handoff
- `marketplace-api/lib/services/orders.ts` for signed intent validation and Fortis transfer dispatch
- `marketplace-api/supabase/migrations/` for the marketplace data model and wallet-first auth setup

Two contribution tips save time quickly:

- If you change transfer-intent signing or verification, keep `backend/src/bin/generate_transfer_request.rs` and `marketplace-api/lib/solana/transfer-intent.ts` aligned.
- If you change transfer policy, review the backend, marketplace order flow, and `rwa_tokenizer` program together. Fortis is intentionally split across those layers.

## Contribution Notes

- See [CONTRIBUTING.md](./CONTRIBUTING.md) for workflow, testing, and review expectations.
- The backend test suite lives under `backend/tests/`.
- Smart contract integration tests live under `contracts/tests/`.
- Marketplace tests live under `marketplace-api/tests/`.

Fortis is licensed under [MIT](./LICENSE).
