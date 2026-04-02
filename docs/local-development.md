# Local Development

## Overview

Fortis is not a single-process app. Local development usually means running:

- Docker PostgreSQL for the Rust backend
- The Rust backend from `backend/`
- The Next.js marketplace from `marketplace-api/`
- Optional local Supabase from `marketplace-api/`
- Optional Anchor and Solana tooling from `contracts/`

The backend and the marketplace can be developed independently, but the full flow requires both plus a reachable Solana RPC target.

## Prerequisites

| Dependency | Why you need it | Notes |
| --- | --- | --- |
| Rust stable + `cargo` | Build and run the backend | `backend/` is a Rust service with SQLx and Axum |
| Docker + Docker Compose | Start backend PostgreSQL locally | `docker-compose.yml` exposes Postgres on `5432` |
| Node.js + `npm` | Run the marketplace and Anchor TypeScript tests/scripts | Needed in both `marketplace-api/` and `contracts/` |
| Solana CLI / Agave toolchain | Build and test the on-chain program | Required for Anchor workflows |
| Anchor CLI `0.32.1` | Build and test `contracts/` | Matches `contracts/Anchor.toml` |
| Supabase CLI (optional) | Run local marketplace auth/data services | Use it from `marketplace-api/` if you want local Supabase |

Recommended on Windows:

- Use WSL2 for Anchor and SBF-heavy contract work. The Solana build toolchain is usually more reliable there than in native Windows shells.

## Environment Files

Fortis uses separate env files for separate runtimes.

| File | Used by | What it typically contains |
| --- | --- | --- |
| `/.env` | Rust backend | `DATABASE_URL`, `SOLANA_RPC_URL`, `ISSUER_PRIVATE_KEY`, backend port/worker settings, provider webhook secrets |
| `/marketplace-api/.env.local` | Next.js marketplace | Supabase URL and keys, `FORTIS_ENGINE_URL`, optional webhook secret, optional marketplace-only overrides |
| Shell env such as `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET` | Anchor CLI and scripts | RPC endpoint and signer path for `anchor build`, `anchor test`, and helper scripts |

High-level expectations:

- `ISSUER_PRIVATE_KEY` in the repo-root `.env` is required for any real backend blockchain submission.
- `SOLANA_RPC_URL` in the repo-root `.env` defaults to devnet if you leave it unchanged.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are required for the marketplace's authenticated flows.
- `FORTIS_ENGINE_URL` in `marketplace-api/.env.local` must point at the Rust backend.

## Recommended Local Topology

The cleanest local setup is:

- Marketplace: `http://localhost:3000`
- Backend: `http://localhost:3002`
- Backend Postgres: `postgres://postgres:postgres@localhost:5432/fortis_rwa_backend`
- Optional local Supabase API: `http://127.0.0.1:54321`

This avoids the default Next.js and backend port collision.

## Backend Startup

### 1. Create the backend env file

From the repo root:

```bash
cp .env.example .env
```

Update at least:

- `ISSUER_PRIVATE_KEY`
- `PORT=3002` if you want the marketplace on `3000`
- `SOLANA_RPC_URL=http://127.0.0.1:8899` only if you intend to use a local validator instead of devnet

Useful optional settings:

- `RANGE_API_KEY` if you want real Range-backed screening instead of mock mode
- `HELIUS_WEBHOOK_SECRET` or `QUICKNODE_WEBHOOK_SECRET` if you are testing provider callbacks
- `ENABLE_BACKGROUND_WORKER` and `ENABLE_STALE_CRANK` if you want to disable specific loops while debugging

### 2. Start Postgres

```bash
docker compose up -d db
```

### 3. Run the backend

```bash
cd backend
cargo run
```

What happens on startup:

- The backend auto-loads the repo-root `.env`.
- SQLx migrations from `backend/migrations/` run automatically.
- The API starts the worker and stale-transaction crank unless you disable them.

Useful backend commands:

```bash
cargo check
cargo test
cargo run --bin generate_transfer_request -- --help
```

Useful backend URLs once it is up, assuming `PORT=3002`:

- `http://localhost:3002/health/live`
- `http://localhost:3002/health/ready`
- `http://localhost:3002/swagger-ui`
- `http://localhost:3002/api-docs/openapi.json`

## Marketplace Startup

### 1. Install dependencies

```bash
cd marketplace-api
npm install
```

### 2. Create or update `marketplace-api/.env.local`

```bash
cp .env.example .env.local
```

Minimum values to set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FORTIS_ENGINE_URL=http://localhost:3002`

Optional values:

- `NEXT_PUBLIC_SOLANA_RPC_URL` if you do not want the wallet flows to use devnet
- `FORTIS_WEBHOOK_SECRET` if you plan to hit the signed internal webhook route
- `FORTIS_ENGINE_TOKEN` only if you add backend-side bearer-token enforcement; the current backend code in this repo does not require it

### 3. Run the app

```bash
npm run dev
```

Useful marketplace commands:

```bash
npm run lint
npm test
npm run build
```

What to expect:

- The home page loads listings from Supabase.
- Listing creation requires authenticated wallet context plus Fortis backend connectivity.
- Order reads refresh Fortis request state by polling the backend on demand.

## Contract and Anchor Workflow

### 1. Install dependencies

```bash
cd contracts
npm install
```

### 2. Build the program

```bash
anchor build
```

### 3. Run the integration tests

```bash
anchor test
```

The test suite in `contracts/tests/rwa-tokenizer.ts` is the clearest live example of the intended contract flow:

- Create Token-2022 mint with transfer hook
- Initialize the extra account meta list
- Initialize the asset record
- Approve sender and receiver wallets
- Perform an allowed transfer
- Revoke a wallet
- Verify the next transfer is blocked

### 4. Optional helper script

For manual mint initialization outside the test suite:

```bash
npx ts-node scripts/initialize-mint.ts
```

Useful env for Anchor and helper scripts:

- `ANCHOR_PROVIDER_URL`
- `ANCHOR_WALLET`

### 5. Point the backend at local Solana if needed

If you want the Rust backend to work against a local validator rather than devnet:

1. Run your local validator or `anchor test` workflow.
2. Set `SOLANA_RPC_URL=http://127.0.0.1:8899` in the repo-root `.env`.
3. Use an issuer key that is funded on that validator.

## Optional Supabase Workflow

Use the Supabase setup inside `marketplace-api/` when working on marketplace auth or schema changes.

### Start local Supabase

```bash
cd marketplace-api
supabase start
```

### Apply or replay migrations

```bash
supabase db reset
```

### Inspect local connection details

```bash
supabase status
```

Use the printed URL and keys to populate `marketplace-api/.env.local`.

Why this matters:

- The repo root also contains `supabase/config.toml`.
- The marketplace also contains `marketplace-api/supabase/config.toml`.
- Both default to the same local Supabase ports, so they will collide if you run both unchanged.

## Common Pitfalls

### Port collisions

- Next.js defaults to `3000`.
- The backend also defaults to `3000`.
- Move one of them before starting both. The simplest setup is marketplace on `3000` and backend on `3002`.

### Two Supabase configs

- `supabase/` at the repo root is not the same thing as `marketplace-api/supabase/`.
- For marketplace schema and wallet auth work, run the CLI from `marketplace-api/`.
- Do not start both configs on the same machine without changing ports.

### Backend Postgres is not marketplace Supabase Postgres

- The Rust backend uses the Postgres instance from `docker-compose.yml`.
- The marketplace uses Supabase tables and policies.
- A successful backend boot does not mean the marketplace database is configured.

### Placeholder issuer key

- `.env.example` intentionally contains a placeholder `ISSUER_PRIVATE_KEY`.
- The backend will refuse to start if you leave it unchanged.

### Mock compliance vs real compliance

- If `RANGE_API_KEY` is missing, the backend runs Range screening in mock mode.
- That is fine for local development, but do not assume those results match production screening behavior.

### Local validator mismatch

- `anchor test` and a local validator only help the backend if `SOLANA_RPC_URL` points at that same validator.
- If the backend still points at devnet, you will see mismatched state and missing accounts.

### Windows contract builds

- Native Windows shells can be frustrating for SBF builds and Solana tooling.
- If contract work becomes unstable, move the Anchor workflow into WSL2 first before debugging application code.
