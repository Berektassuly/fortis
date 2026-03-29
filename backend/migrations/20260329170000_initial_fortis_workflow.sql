CREATE TABLE IF NOT EXISTS transfer_requests (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    source_owner_address TEXT,
    amount BIGINT NOT NULL,
    token_mint TEXT,
    compliance_status TEXT NOT NULL,
    blockchain_status TEXT NOT NULL,
    blockchain_signature TEXT,
    blockchain_retry_count INTEGER NOT NULL DEFAULT 0,
    blockchain_last_error TEXT,
    blockchain_next_retry_at TIMESTAMPTZ,
    asset_record_pda TEXT,
    sender_compliance_pda TEXT,
    receiver_compliance_pda TEXT,
    range_risk_score INTEGER,
    range_risk_level TEXT,
    range_reasoning TEXT,
    original_tx_signature TEXT,
    last_error_type TEXT NOT NULL DEFAULT 'none',
    blockhash_used TEXT,
    nonce TEXT UNIQUE,
    client_signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_worker_queue
    ON transfer_requests (blockchain_status, compliance_status, blockchain_next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_signature
    ON transfer_requests (blockchain_signature);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_nonce
    ON transfer_requests (from_address, nonce);

CREATE TABLE IF NOT EXISTS wallet_approvals (
    id UUID PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    token_mint TEXT NOT NULL,
    asset_record_pda TEXT NOT NULL,
    compliance_record_pda TEXT NOT NULL,
    compliance_level TEXT NOT NULL,
    range_risk_score INTEGER,
    range_risk_level TEXT,
    range_reasoning TEXT,
    anchor_tx_signature TEXT,
    anchor_status TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wallet_approvals_wallet_mint_unique UNIQUE (wallet_address, token_mint)
);

CREATE INDEX IF NOT EXISTS idx_wallet_approvals_processing
    ON wallet_approvals (anchor_status, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS wallet_risk_profiles (
    address TEXT PRIMARY KEY,
    risk_score INTEGER,
    risk_level TEXT,
    reasoning TEXT,
    has_sanctioned_assets BOOLEAN NOT NULL DEFAULT FALSE,
    helius_assets_checked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocklist (
    address TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
