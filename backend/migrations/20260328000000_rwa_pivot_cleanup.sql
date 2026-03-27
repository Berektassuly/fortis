-- Pivot the backend from confidential-transfer support to Fortis RWA wallet approvals.
-- This migration is forward-only: legacy migrations remain in place for historical environments.

-- ---------------------------------------------------------------------------
-- Transfer request cleanup
-- ---------------------------------------------------------------------------
ALTER TABLE transfer_requests
    DROP COLUMN IF EXISTS transfer_type,
    DROP COLUMN IF EXISTS new_decryptable_available_balance,
    DROP COLUMN IF EXISTS equality_proof,
    DROP COLUMN IF EXISTS ciphertext_validity_proof,
    DROP COLUMN IF EXISTS range_proof;

ALTER TABLE transfer_requests
    ALTER COLUMN amount SET NOT NULL,
    ALTER COLUMN blockchain_status SET DEFAULT 'received';

ALTER TABLE transfer_requests
    ADD COLUMN IF NOT EXISTS asset_record_pda TEXT,
    ADD COLUMN IF NOT EXISTS sender_compliance_pda TEXT,
    ADD COLUMN IF NOT EXISTS receiver_compliance_pda TEXT,
    ADD COLUMN IF NOT EXISTS range_risk_score INTEGER,
    ADD COLUMN IF NOT EXISTS range_risk_level TEXT,
    ADD COLUMN IF NOT EXISTS range_reasoning TEXT;

COMMENT ON COLUMN transfer_requests.asset_record_pda IS
    'Fortis RWA asset PDA derived from ["asset", mint] for the transfer mint';
COMMENT ON COLUMN transfer_requests.sender_compliance_pda IS
    'Optional sender compliance PDA derived from ["compliance", mint, sender]';
COMMENT ON COLUMN transfer_requests.receiver_compliance_pda IS
    'Optional receiver compliance PDA derived from ["compliance", mint, receiver]';
COMMENT ON COLUMN transfer_requests.range_risk_score IS
    'Frozen Range Protocol score captured when the transfer was approved';
COMMENT ON COLUMN transfer_requests.range_risk_level IS
    'Frozen Range Protocol risk label captured when the transfer was approved';
COMMENT ON COLUMN transfer_requests.range_reasoning IS
    'Frozen Range Protocol reasoning captured when the transfer was approved';

-- ---------------------------------------------------------------------------
-- Wallet approval queue / audit table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_approvals (
    id UUID PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    token_mint TEXT NOT NULL,
    asset_record_pda TEXT NOT NULL,
    compliance_record_pda TEXT NOT NULL UNIQUE,
    compliance_level TEXT NOT NULL,
    range_risk_score INTEGER,
    range_risk_level TEXT,
    range_reasoning TEXT,
    anchor_tx_signature TEXT,
    anchor_status TEXT NOT NULL DEFAULT 'received',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (wallet_address, token_mint)
);

CREATE INDEX IF NOT EXISTS idx_wallet_approvals_retry_queue
    ON wallet_approvals(anchor_status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_wallet_approvals_approved_lookup
    ON wallet_approvals(wallet_address, token_mint, anchor_status);

COMMENT ON TABLE wallet_approvals IS
    'Queued and completed Fortis RWA wallet approval jobs for approve_wallet submissions';
COMMENT ON COLUMN wallet_approvals.asset_record_pda IS
    'Fortis RWA asset PDA derived from ["asset", mint]';
COMMENT ON COLUMN wallet_approvals.compliance_record_pda IS
    'Fortis RWA compliance PDA derived from ["compliance", mint, wallet]';
COMMENT ON COLUMN wallet_approvals.compliance_level IS
    'Compliance level serialized for the Anchor approve_wallet instruction';
COMMENT ON COLUMN wallet_approvals.anchor_status IS
    'Wallet approval lifecycle: received, processing, approved, or failed';
