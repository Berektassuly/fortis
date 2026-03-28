# Fortis

Fortis is a Solana RWA monorepo. It combines an on-chain Token-2022 transfer-hook program with a Rust backend that screens wallets, creates compliance approvals, and only relays public transfers after the receiver has been approved on chain.

## Repository Layout

| Path | Purpose |
|------|---------|
| `backend/` | Rust API, worker, crank, SQLx/Postgres integration, and Dockerized backend service |
| `programs/rwa_tokenizer/` | Anchor program that enforces per-wallet compliance during Token-2022 transfers |
| `tests/` | TypeScript Anchor integration tests |
| `scripts/` | Operational and setup scripts for the Solana side of the system |
| `app/` | Reserved application workspace for future client-facing code |

## RWA Architecture

Fortis splits compliance enforcement across off-chain orchestration and on-chain validation:

1. A client signs a public Token-2022 transfer request.
2. The backend validates the signature and stores the request in PostgreSQL.
3. The backend screens the receiver with an internal blocklist, Range Protocol risk checks, and optional Helius DAS data.
4. A wallet-approval job is enqueued for the `(wallet_address, token_mint)` pair.
5. The backend worker submits `approve_wallet` to the `rwa_tokenizer` Anchor program.
6. The on-chain program writes per-wallet compliance PDAs that the Token-2022 transfer hook can verify.
7. After approval is confirmed, the backend relays the public transfer and tracks final state through webhooks plus the stale-transaction crank.

## Component Responsibilities

### On-Chain Program

`programs/rwa_tokenizer` stores asset metadata and compliance state in PDAs:

- `AssetRecord` stores mint-level asset metadata and authority.
- `ComplianceRecord` stores compliance status for a specific `(mint, wallet)` pair.
- The Token-2022 transfer hook blocks transfers unless both sender and receiver have valid approved compliance records.

### Backend Service

`backend/` provides the operational control plane for the transfer flow:

- Axum HTTP API for signed transfer submission, status APIs, health checks, and admin blocklist management
- PostgreSQL persistence for transfer requests, wallet approvals, retries, and cached risk results
- Background worker for on-chain `approve_wallet` submissions
- Webhook handlers and stale-transaction crank for confirmation reliability
- Optional provider-specific behavior for Helius, QuickNode, and Jito-enabled submission flows

The backend now expects shared environment files at the repo root. When you run it from `backend/`, it traverses upward and loads `../.env` automatically.

## Getting Started

### Backend Development

1. Copy the root environment template:

```bash
cp .env.example .env
```

2. Start PostgreSQL from the repo root:

```bash
docker compose up -d db
```

3. Run the backend from its crate directory:

```bash
cd backend
cargo check
cargo run
```

The backend listens on `http://localhost:3000` by default and applies SQLx migrations from `backend/migrations/` during startup.

### Anchor Program Development

Install the Solana/Agave SBF toolchain plus Anchor CLI `0.32.1`, then from the repo root run:

```bash
npm install
anchor build
anchor test
```

Windows development is typically easiest in WSL2 or a Linux/macOS environment because the Solana SBF toolchain is not reliably supported in native Windows shells.

## Docker

The Docker assets now live at the repository root and build the backend from the monorepo context:

```bash
docker build -f Dockerfile .
docker compose up --build
```

Create `./.env` first so Compose can inject the backend environment.

## Contributing

Contributor guidelines live in [CONTRIBUTING.md](./CONTRIBUTING.md). The project is licensed under [MIT](./LICENSE).
