//! PostgreSQL database client implementation.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use std::time::Duration;
use tracing::{info, instrument};

use crate::domain::ComplianceLevel;
use crate::domain::types::{derive_asset_record_pda, derive_compliance_record_pda};
use crate::domain::{
    AppError, BlockchainStatus, ComplianceDecision, ComplianceStatus, DatabaseClient,
    DatabaseError, LastErrorType, PaginatedResponse, SubmitTransferRequest, TransferRequest,
    TransferType, WalletApproval, WalletApprovalStatus, WalletRiskProfile,
};

/// PostgreSQL connection pool configuration
#[derive(Debug, Clone)]
pub struct PostgresConfig {
    pub max_connections: u32,
    pub min_connections: u32,
    pub acquire_timeout: Duration,
    pub idle_timeout: Duration,
    pub max_lifetime: Duration,
}

impl Default for PostgresConfig {
    fn default() -> Self {
        Self {
            max_connections: 10,
            min_connections: 2,
            acquire_timeout: Duration::from_secs(3),
            idle_timeout: Duration::from_secs(600),
            max_lifetime: Duration::from_secs(1800),
        }
    }
}

/// PostgreSQL database client with connection pooling
pub struct PostgresClient {
    pool: PgPool,
}

impl PostgresClient {
    /// Create a new PostgreSQL client with custom configuration
    pub async fn new(database_url: &str, config: PostgresConfig) -> Result<Self, AppError> {
        info!("Connecting to PostgreSQL...");
        let pool = PgPoolOptions::new()
            .max_connections(config.max_connections)
            .min_connections(config.min_connections)
            .acquire_timeout(config.acquire_timeout)
            .idle_timeout(config.idle_timeout)
            .max_lifetime(config.max_lifetime)
            .connect(database_url)
            .await
            .map_err(|e| AppError::Database(DatabaseError::Connection(e.to_string())))?;
        info!("Connected to PostgreSQL");
        Ok(Self { pool })
    }

    /// Create a new PostgreSQL client with default configuration
    pub async fn with_defaults(database_url: &str) -> Result<Self, AppError> {
        Self::new(database_url, PostgresConfig::default()).await
    }

    /// Run database migrations using sqlx migrate
    pub async fn run_migrations(&self) -> Result<(), AppError> {
        info!("Running database migrations...");
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .map_err(|e| AppError::Database(DatabaseError::Migration(e.to_string())))?;
        info!("Database migrations completed successfully");
        Ok(())
    }

    /// Get the underlying connection pool (for testing)
    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Parse a database row into a TransferRequest
    fn row_to_transfer_request(row: &sqlx::postgres::PgRow) -> Result<TransferRequest, AppError> {
        let compliance_status_str: String = row.get("compliance_status");
        let blockchain_status_str: String = row.get("blockchain_status");
        let amount_opt: Option<i64> = row.get("amount");

        // Jito Double Spend Protection fields
        let original_tx_signature: Option<String> =
            row.try_get("original_tx_signature").ok().flatten();
        let last_error_type_str: Option<String> = row.try_get("last_error_type").ok().flatten();
        let blockhash_used: Option<String> = row.try_get("blockhash_used").ok().flatten();

        let last_error_type = last_error_type_str
            .as_deref()
            .and_then(|s| s.parse().ok())
            .unwrap_or(LastErrorType::None);

        // Request Uniqueness fields (Replay Protection & Idempotency)
        let nonce: Option<String> = row.try_get("nonce").ok().flatten();
        let client_signature: Option<String> = row.try_get("client_signature").ok().flatten();

        Ok(TransferRequest {
            id: row.get("id"),
            from_address: row.get("from_address"),
            to_address: row.get("to_address"),
            source_owner_address: row.try_get("source_owner_address").ok().flatten(),
            transfer_details: TransferType::Public {
                amount: amount_opt.unwrap_or_default() as u64,
            },
            token_mint: row.get("token_mint"),
            asset_record_pda: row.try_get("asset_record_pda").ok().flatten(),
            sender_compliance_pda: row.try_get("sender_compliance_pda").ok().flatten(),
            receiver_compliance_pda: row.try_get("receiver_compliance_pda").ok().flatten(),
            range_risk_score: row.try_get("range_risk_score").ok().flatten(),
            range_risk_level: row.try_get("range_risk_level").ok().flatten(),
            range_reasoning: row.try_get("range_reasoning").ok().flatten(),
            compliance_status: compliance_status_str
                .parse()
                .unwrap_or(ComplianceStatus::Pending),
            blockchain_status: blockchain_status_str
                .parse()
                .unwrap_or(BlockchainStatus::Pending),
            blockchain_signature: row.get("blockchain_signature"),
            blockchain_retry_count: row.get("blockchain_retry_count"),
            blockchain_last_error: row.get("blockchain_last_error"),
            blockchain_next_retry_at: row.get("blockchain_next_retry_at"),
            // Jito Double Spend Protection fields
            original_tx_signature,
            last_error_type,
            blockhash_used,
            // Request Uniqueness fields
            nonce,
            client_signature,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    fn row_to_wallet_approval(row: &sqlx::postgres::PgRow) -> Result<WalletApproval, AppError> {
        let id: uuid::Uuid = row.get("id");
        let compliance_level: String = row.get("compliance_level");
        let anchor_status: String = row.get("anchor_status");

        Ok(WalletApproval {
            id: id.to_string(),
            wallet_address: row.get("wallet_address"),
            token_mint: row.get("token_mint"),
            asset_record_pda: row.get("asset_record_pda"),
            compliance_record_pda: row.get("compliance_record_pda"),
            compliance_level: compliance_level
                .parse()
                .unwrap_or(ComplianceLevel::Standard),
            range_risk_score: row.try_get("range_risk_score").ok().flatten(),
            range_risk_level: row.try_get("range_risk_level").ok().flatten(),
            range_reasoning: row.try_get("range_reasoning").ok().flatten(),
            anchor_tx_signature: row.try_get("anchor_tx_signature").ok().flatten(),
            anchor_status: anchor_status
                .parse()
                .unwrap_or(WalletApprovalStatus::Received),
            retry_count: row.get("retry_count"),
            last_error: row.try_get("last_error").ok().flatten(),
            next_retry_at: row.try_get("next_retry_at").ok().flatten(),
            approved_at: row.try_get("approved_at").ok().flatten(),
            expires_at: row.try_get("expires_at").ok().flatten(),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    fn parse_wallet_approval_id(id: &str) -> Result<uuid::Uuid, AppError> {
        uuid::Uuid::parse_str(id).map_err(|e| {
            AppError::Validation(crate::domain::ValidationError::InvalidField {
                field: "id".to_string(),
                message: format!("Invalid wallet approval id: {}", e),
            })
        })
    }
}

#[async_trait]
impl DatabaseClient for PostgresClient {
    #[instrument(skip(self))]
    async fn health_check(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Database(DatabaseError::Connection(e.to_string())))?;
        Ok(())
    }

    #[instrument(skip(self))]
    async fn get_transfer_request(&self, id: &str) -> Result<Option<TransferRequest>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT id, from_address, to_address, source_owner_address, amount, token_mint, compliance_status,
                   blockchain_status, blockchain_signature, blockchain_retry_count,
                   blockchain_last_error, blockchain_next_retry_at,
                   created_at, updated_at,
                   asset_record_pda, sender_compliance_pda, receiver_compliance_pda,
                   range_risk_score, range_risk_level, range_reasoning,
                   original_tx_signature, last_error_type, blockhash_used,
                   nonce, client_signature
            FROM transfer_requests 
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_transfer_request(&row)?)),
            None => Ok(None),
        }
    }

    #[instrument(skip(self, data), fields(from = %data.from_address, to = %data.to_address, nonce = %data.nonce))]
    async fn submit_transfer(
        &self,
        data: &SubmitTransferRequest,
    ) -> Result<TransferRequest, AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let TransferType::Public { amount } = &data.transfer_details;

        // Insert with nonce - uses UNIQUE constraint for idempotency
        // ON CONFLICT handles race condition: if another request with same nonce
        // was inserted between our check and insert, return the existing row
        let row = sqlx::query(
            r#"
            INSERT INTO transfer_requests (
                id, from_address, to_address, source_owner_address, amount, token_mint,
                compliance_status, blockchain_status, blockchain_retry_count,
                created_at, updated_at,
                nonce, client_signature
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (nonce) WHERE nonce IS NOT NULL
            DO UPDATE SET id = transfer_requests.id
            RETURNING id, from_address, to_address, source_owner_address, amount, token_mint,
                      compliance_status, blockchain_status, blockchain_signature,
                      blockchain_retry_count, blockchain_last_error, blockchain_next_retry_at,
                      created_at, updated_at,
                      asset_record_pda, sender_compliance_pda, receiver_compliance_pda,
                      range_risk_score, range_risk_level, range_reasoning,
                      original_tx_signature, last_error_type, blockhash_used,
                      nonce, client_signature
            "#,
        )
        .bind(&id)
        .bind(&data.from_address)
        .bind(&data.to_address)
        .bind(data.source_owner_address.as_deref())
        .bind(*amount as i64)
        .bind(data.token_mint.as_deref())
        .bind(ComplianceStatus::Pending.as_str())
        .bind(BlockchainStatus::Received.as_str()) // Receive→Persist→Process: persist BEFORE compliance
        .bind(0i32)
        .bind(now)
        .bind(now)
        .bind(&data.nonce)
        .bind(&data.signature)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::from(e)))?;

        // Parse the returned row (handles both new insert and existing row on conflict)
        Self::row_to_transfer_request(&row)
    }

    #[instrument(skip(self, decision, approval), fields(id = %id))]
    async fn mark_transfer_approved(
        &self,
        id: &str,
        decision: &ComplianceDecision,
        approval: &WalletApproval,
    ) -> Result<(), AppError> {
        let now = Utc::now();
        sqlx::query(
            r#"
            UPDATE transfer_requests
            SET compliance_status = $1,
                asset_record_pda = $2,
                receiver_compliance_pda = $3,
                range_risk_score = $4,
                range_risk_level = $5,
                range_reasoning = $6,
                updated_at = $7
            WHERE id = $8
            "#,
        )
        .bind(decision.status.as_str())
        .bind(&approval.asset_record_pda)
        .bind(&approval.compliance_record_pda)
        .bind(decision.risk_score)
        .bind(&decision.risk_level)
        .bind(&decision.reasoning)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        Ok(())
    }

    #[instrument(skip(self), fields(id = %id))]
    async fn enqueue_transfer_submission(&self, id: &str) -> Result<(), AppError> {
        self.update_blockchain_status(
            id,
            BlockchainStatus::PendingSubmission,
            None,
            None,
            None,
            None,
        )
        .await
    }

    #[instrument(skip(self))]
    async fn list_transfer_requests(
        &self,
        limit: i64,
        cursor: Option<&str>,
    ) -> Result<PaginatedResponse<TransferRequest>, AppError> {
        // Clamp limit to valid range
        let limit = limit.clamp(1, 100);
        // Fetch one extra to determine if there are more items
        let fetch_limit = limit + 1;

        let rows = match cursor {
            Some(cursor_id) => {
                // Get the created_at of the cursor item for proper pagination
                let cursor_row =
                    sqlx::query("SELECT created_at FROM transfer_requests WHERE id = $1")
                        .bind(cursor_id)
                        .fetch_optional(&self.pool)
                        .await
                        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

                let cursor_created_at: DateTime<Utc> = match cursor_row {
                    Some(row) => row.get("created_at"),
                    None => {
                        return Err(AppError::Validation(
                            crate::domain::ValidationError::InvalidField {
                                field: "cursor".to_string(),
                                message: "Invalid cursor".to_string(),
                            },
                        ));
                    }
                };

                sqlx::query(
                    r#"
                    SELECT id, from_address, to_address, source_owner_address, amount, token_mint, compliance_status,
                           blockchain_status, blockchain_signature, blockchain_retry_count,
                           blockchain_last_error, blockchain_next_retry_at,
                           created_at, updated_at,
                           asset_record_pda, sender_compliance_pda, receiver_compliance_pda,
                           range_risk_score, range_risk_level, range_reasoning,
                           original_tx_signature, last_error_type, blockhash_used,
                           nonce, client_signature
                    FROM transfer_requests
                    WHERE (created_at, id) < ($1, $2)
                    ORDER BY created_at DESC, id DESC
                    LIMIT $3
                    "#,
                )
                .bind(cursor_created_at)
                .bind(cursor_id)
                .bind(fetch_limit)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?
            }
            None => sqlx::query(
                r#"
                    SELECT id, from_address, to_address, source_owner_address, amount, token_mint, compliance_status,
                           blockchain_status, blockchain_signature, blockchain_retry_count,
                           blockchain_last_error, blockchain_next_retry_at,
                           created_at, updated_at,
                           asset_record_pda, sender_compliance_pda, receiver_compliance_pda,
                           range_risk_score, range_risk_level, range_reasoning,
                           original_tx_signature, last_error_type, blockhash_used,
                           nonce, client_signature
                    FROM transfer_requests
                    ORDER BY created_at DESC, id DESC
                    LIMIT $1
                    "#,
            )
            .bind(fetch_limit)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?,
        };

        let has_more = rows.len() > limit as usize;
        let requests: Vec<TransferRequest> = rows
            .iter()
            .take(limit as usize)
            .map(Self::row_to_transfer_request)
            .collect::<Result<Vec<_>, _>>()?;

        let next_cursor = if has_more {
            requests.last().map(|req| req.id.clone())
        } else {
            None
        };

        Ok(PaginatedResponse::new(requests, next_cursor, has_more))
    }

    #[instrument(skip(self), fields(id = %id, status = %status.as_str()))]
    async fn update_blockchain_status(
        &self,
        id: &str,
        status: BlockchainStatus,
        signature: Option<&str>,
        error: Option<&str>,
        next_retry_at: Option<DateTime<Utc>>,
        blockhash_used: Option<&str>,
    ) -> Result<(), AppError> {
        let now = Utc::now();

        let result = sqlx::query(
            r#"
            UPDATE transfer_requests 
            SET blockchain_status = $1,
                blockchain_signature = COALESCE($2, blockchain_signature),
                blockchain_last_error = $3,
                blockchain_next_retry_at = $4,
                blockhash_used = COALESCE($5, blockhash_used),
                updated_at = $6
            WHERE id = $7
            "#,
        )
        .bind(status.as_str())
        .bind(signature)
        .bind(error)
        .bind(next_retry_at)
        .bind(blockhash_used)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        // Verify the update actually affected a row
        if result.rows_affected() == 0 {
            tracing::warn!(id = %id, "update_blockchain_status: no rows affected (record may not exist)");
            return Err(AppError::Database(DatabaseError::NotFound(id.to_string())));
        }

        tracing::debug!(id = %id, status = %status.as_str(), "Blockchain status updated");
        Ok(())
    }

    #[instrument(skip(self), fields(id = %id, status = %status.as_str()))]
    async fn update_compliance_status(
        &self,
        id: &str,
        status: ComplianceStatus,
    ) -> Result<(), AppError> {
        let now = Utc::now();
        let result = sqlx::query(
            r#"
            UPDATE transfer_requests 
            SET compliance_status = $1,
                updated_at = $2
            WHERE id = $3
            "#,
        )
        .bind(status.as_str())
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        // Verify the update actually affected a row
        if result.rows_affected() == 0 {
            tracing::warn!(id = %id, "update_compliance_status: no rows affected (record may not exist)");
            return Err(AppError::Database(DatabaseError::NotFound(id.to_string())));
        }

        tracing::debug!(id = %id, status = %status.as_str(), "Compliance status updated");
        Ok(())
    }

    #[instrument(skip(self, decision), fields(wallet = %wallet_address, token_mint = %token_mint))]
    async fn enqueue_wallet_approval_if_missing(
        &self,
        token_mint: &str,
        wallet_address: &str,
        decision: &ComplianceDecision,
    ) -> Result<WalletApproval, AppError> {
        let asset_record_pda = derive_asset_record_pda(token_mint)?;
        let compliance_record_pda = derive_compliance_record_pda(token_mint, wallet_address)?;

        let row = sqlx::query(
            r#"
            INSERT INTO wallet_approvals (
                id, wallet_address, token_mint, asset_record_pda, compliance_record_pda,
                compliance_level, range_risk_score, range_risk_level, range_reasoning,
                anchor_status, retry_count, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'received', 0, NOW(), NOW())
            ON CONFLICT (wallet_address, token_mint)
            DO UPDATE SET
                asset_record_pda = EXCLUDED.asset_record_pda,
                compliance_record_pda = EXCLUDED.compliance_record_pda,
                compliance_level = EXCLUDED.compliance_level,
                range_risk_score = EXCLUDED.range_risk_score,
                range_risk_level = EXCLUDED.range_risk_level,
                range_reasoning = EXCLUDED.range_reasoning,
                last_error = NULL,
                next_retry_at = NULL,
                updated_at = NOW(),
                anchor_status = CASE
                    WHEN wallet_approvals.anchor_status = 'failed' THEN 'received'
                    ELSE wallet_approvals.anchor_status
                END
            RETURNING id, wallet_address, token_mint, asset_record_pda, compliance_record_pda,
                      compliance_level, range_risk_score, range_risk_level, range_reasoning,
                      anchor_tx_signature, anchor_status, retry_count, last_error, next_retry_at,
                      approved_at, expires_at, created_at, updated_at
            "#,
        )
        .bind(uuid::Uuid::new_v4())
        .bind(wallet_address)
        .bind(token_mint)
        .bind(asset_record_pda)
        .bind(compliance_record_pda)
        .bind(decision.level.as_str())
        .bind(decision.risk_score)
        .bind(&decision.risk_level)
        .bind(&decision.reasoning)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::from(e)))?;

        Self::row_to_wallet_approval(&row)
    }

    #[instrument(skip(self), fields(limit = %limit))]
    async fn get_pending_wallet_approvals(
        &self,
        limit: i64,
    ) -> Result<Vec<WalletApproval>, AppError> {
        let rows = sqlx::query(
            r#"
            UPDATE wallet_approvals
            SET anchor_status = 'processing',
                updated_at = NOW()
            WHERE id IN (
                SELECT id FROM wallet_approvals
                WHERE (anchor_status = 'received'
                       OR (anchor_status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes'))
                  AND (next_retry_at IS NULL OR next_retry_at <= NOW())
                  AND retry_count < 10
                ORDER BY next_retry_at ASC NULLS FIRST, created_at ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, wallet_address, token_mint, asset_record_pda, compliance_record_pda,
                      compliance_level, range_risk_score, range_risk_level, range_reasoning,
                      anchor_tx_signature, anchor_status, retry_count, last_error, next_retry_at,
                      approved_at, expires_at, created_at, updated_at
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        rows.iter().map(Self::row_to_wallet_approval).collect()
    }

    #[instrument(skip(self), fields(id = %id, status = %status.as_str()))]
    async fn update_wallet_approval_status(
        &self,
        id: &str,
        status: WalletApprovalStatus,
        signature: Option<&str>,
        error: Option<&str>,
        next_retry_at: Option<DateTime<Utc>>,
        approved_at: Option<DateTime<Utc>>,
    ) -> Result<(), AppError> {
        let wallet_approval_id = Self::parse_wallet_approval_id(id)?;

        sqlx::query(
            r#"
            UPDATE wallet_approvals
            SET anchor_status = $1,
                anchor_tx_signature = COALESCE($2, anchor_tx_signature),
                last_error = $3,
                next_retry_at = $4,
                approved_at = COALESCE($5, approved_at),
                updated_at = NOW()
            WHERE id = $6
            "#,
        )
        .bind(status.as_str())
        .bind(signature)
        .bind(error)
        .bind(next_retry_at)
        .bind(approved_at)
        .bind(wallet_approval_id)
        .execute(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        Ok(())
    }

    #[instrument(skip(self), fields(id = %id))]
    async fn increment_wallet_approval_retry_count(&self, id: &str) -> Result<i32, AppError> {
        let wallet_approval_id = Self::parse_wallet_approval_id(id)?;

        let row = sqlx::query(
            r#"
            UPDATE wallet_approvals
            SET retry_count = retry_count + 1,
                updated_at = NOW()
            WHERE id = $1
            RETURNING retry_count
            "#,
        )
        .bind(wallet_approval_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        Ok(row.get("retry_count"))
    }

    /// Get pending blockchain requests and atomically claim them for processing.
    /// Uses UPDATE...RETURNING with FOR UPDATE SKIP LOCKED to prevent race conditions.
    /// Returned rows are already in 'processing' status.
    #[instrument(skip(self), fields(limit = %limit))]
    async fn get_pending_blockchain_requests(
        &self,
        limit: i64,
    ) -> Result<Vec<TransferRequest>, AppError> {
        let now = Utc::now();
        tracing::debug!(
            now = %now,
            limit = limit,
            "Querying for pending blockchain requests (status=pending_submission, compliance=approved)"
        );
        // Atomic claim: SELECT eligible rows with FOR UPDATE SKIP LOCKED,
        // UPDATE them to 'processing', and RETURN them in one operation.
        // This prevents race conditions when multiple worker replicas are running.
        let rows = sqlx::query(
            r#"
            UPDATE transfer_requests
            SET blockchain_status = 'processing',
                updated_at = NOW()
            WHERE id IN (
                SELECT transfer_requests.id FROM transfer_requests
                LEFT JOIN wallet_approvals
                    ON wallet_approvals.wallet_address = transfer_requests.to_address
                   AND wallet_approvals.token_mint = transfer_requests.token_mint
                WHERE (transfer_requests.blockchain_status = 'pending_submission'
                       OR (transfer_requests.blockchain_status = 'processing'
                           AND transfer_requests.updated_at < NOW() - INTERVAL '5 minutes'))
                  AND transfer_requests.compliance_status = 'approved'
                  AND wallet_approvals.anchor_status = 'approved'
                  AND (transfer_requests.blockchain_next_retry_at IS NULL
                       OR transfer_requests.blockchain_next_retry_at <= $1)
                  AND transfer_requests.blockchain_retry_count < 10
                ORDER BY transfer_requests.blockchain_next_retry_at ASC NULLS FIRST,
                         transfer_requests.created_at ASC
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, from_address, to_address, source_owner_address, amount, token_mint, compliance_status,
                      blockchain_status, blockchain_signature, blockchain_retry_count,
                      blockchain_last_error, blockchain_next_retry_at, created_at, updated_at,
                      asset_record_pda, sender_compliance_pda, receiver_compliance_pda,
                      range_risk_score, range_risk_level, range_reasoning,
                      original_tx_signature, last_error_type, blockhash_used,
                      nonce, client_signature
            "#,
        )
        .bind(now)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        rows.iter().map(Self::row_to_transfer_request).collect()
    }

    #[instrument(skip(self))]
    async fn increment_retry_count(&self, id: &str) -> Result<i32, AppError> {
        let row = sqlx::query(
            r#"
            UPDATE transfer_requests 
            SET blockchain_retry_count = blockchain_retry_count + 1,
                updated_at = NOW()
            WHERE id = $1
            RETURNING blockchain_retry_count
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        Ok(row.get("blockchain_retry_count"))
    }

    #[instrument(skip(self))]
    async fn get_transfer_by_signature(
        &self,
        signature: &str,
    ) -> Result<Option<TransferRequest>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT id, from_address, to_address, source_owner_address, amount, token_mint, compliance_status,
                   blockchain_status, blockchain_signature, blockchain_retry_count,
                   blockchain_last_error, blockchain_next_retry_at,
                   created_at, updated_at,
                   asset_record_pda, sender_compliance_pda, receiver_compliance_pda,
                   range_risk_score, range_risk_level, range_reasoning,
                   original_tx_signature, last_error_type, blockhash_used,
                   nonce, client_signature
            FROM transfer_requests 
            WHERE blockchain_signature = $1
            "#,
        )
        .bind(signature)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_transfer_request(&row)?)),
            None => Ok(None),
        }
    }

    // =========================================================================
    // Request Uniqueness Methods (Replay Protection & Idempotency)
    // =========================================================================

    /// Find an existing request by from_address and nonce.
    /// Used to check for duplicate requests (idempotency) and prevent replay attacks.
    #[instrument(skip(self))]
    async fn find_by_nonce(
        &self,
        from_address: &str,
        nonce: &str,
    ) -> Result<Option<TransferRequest>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT id, from_address, to_address, source_owner_address, amount, token_mint, compliance_status,
                   blockchain_status, blockchain_signature, blockchain_retry_count,
                   blockchain_last_error, blockchain_next_retry_at,
                   created_at, updated_at,
                   asset_record_pda, sender_compliance_pda, receiver_compliance_pda,
                   range_risk_score, range_risk_level, range_reasoning,
                   original_tx_signature, last_error_type, blockhash_used,
                   nonce, client_signature
            FROM transfer_requests 
            WHERE from_address = $1 AND nonce = $2
            "#,
        )
        .bind(from_address)
        .bind(nonce)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_transfer_request(&row)?)),
            None => Ok(None),
        }
    }

    // =========================================================================
    // Jito Double Spend Protection Methods
    // =========================================================================

    /// Update Jito tracking fields for a transfer request.
    /// Used to store the original signature, error type, and blockhash for safe retry logic.
    #[instrument(skip(self))]
    async fn update_jito_tracking(
        &self,
        id: &str,
        original_tx_signature: Option<&str>,
        last_error_type: LastErrorType,
        blockhash_used: Option<&str>,
    ) -> Result<(), AppError> {
        let now = Utc::now();

        sqlx::query(
            r#"
            UPDATE transfer_requests 
            SET original_tx_signature = COALESCE($1, original_tx_signature),
                last_error_type = $2,
                blockhash_used = COALESCE($3, blockhash_used),
                updated_at = $4
            WHERE id = $5
            "#,
        )
        .bind(original_tx_signature)
        .bind(last_error_type.as_str())
        .bind(blockhash_used)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        Ok(())
    }

    // =========================================================================
    // Active Polling Fallback (Crank) Methods
    // =========================================================================

    /// Get transactions stuck in `submitted` state for longer than the specified duration.
    /// Used by the active polling fallback (crank) to detect stale transactions.
    #[instrument(skip(self))]
    async fn get_stale_submitted_transactions(
        &self,
        older_than_secs: i64,
        limit: i64,
    ) -> Result<Vec<TransferRequest>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT id, from_address, to_address, source_owner_address, amount, token_mint, compliance_status,
                   blockchain_status, blockchain_signature, blockchain_retry_count,
                   blockchain_last_error, blockchain_next_retry_at,
                   created_at, updated_at,
                   asset_record_pda, sender_compliance_pda, receiver_compliance_pda,
                   range_risk_score, range_risk_level, range_reasoning,
                   original_tx_signature, last_error_type, blockhash_used,
                   nonce, client_signature
            FROM transfer_requests
            WHERE blockchain_status = 'submitted'
              AND updated_at < NOW() - make_interval(secs => $1)
            ORDER BY updated_at ASC
            LIMIT $2
            "#,
        )
        .bind(older_than_secs as f64)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        rows.iter().map(Self::row_to_transfer_request).collect()
    }

    // =========================================================================
    // Risk Profile Methods (for pre-flight compliance screening cache)
    // =========================================================================

    #[instrument(skip(self))]
    async fn get_risk_profile(
        &self,
        address: &str,
        max_age_secs: i64,
    ) -> Result<Option<WalletRiskProfile>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT address, risk_score, risk_level, reasoning,
                   has_sanctioned_assets, helius_assets_checked, created_at, updated_at
            FROM wallet_risk_profiles
            WHERE address = $1
              AND updated_at > NOW() - make_interval(secs => $2)
            "#,
        )
        .bind(address)
        .bind(max_age_secs as f64)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        match row {
            Some(row) => Ok(Some(WalletRiskProfile {
                address: row.get("address"),
                risk_score: row.get("risk_score"),
                risk_level: row.get("risk_level"),
                reasoning: row.get("reasoning"),
                has_sanctioned_assets: row.get("has_sanctioned_assets"),
                helius_assets_checked: row.get("helius_assets_checked"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })),
            None => Ok(None),
        }
    }

    #[instrument(skip(self, profile))]
    async fn upsert_risk_profile(&self, profile: &WalletRiskProfile) -> Result<(), AppError> {
        sqlx::query(
            r#"
            INSERT INTO wallet_risk_profiles 
                (address, risk_score, risk_level, reasoning, 
                 has_sanctioned_assets, helius_assets_checked, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            ON CONFLICT (address) DO UPDATE SET
                risk_score = EXCLUDED.risk_score,
                risk_level = EXCLUDED.risk_level,
                reasoning = EXCLUDED.reasoning,
                has_sanctioned_assets = EXCLUDED.has_sanctioned_assets,
                helius_assets_checked = EXCLUDED.helius_assets_checked,
                updated_at = NOW()
            "#,
        )
        .bind(&profile.address)
        .bind(profile.risk_score)
        .bind(&profile.risk_level)
        .bind(&profile.reasoning)
        .bind(profile.has_sanctioned_assets)
        .bind(profile.helius_assets_checked)
        .execute(&self.pool)
        .await
        .map_err(|e| AppError::Database(DatabaseError::Query(e.to_string())))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_postgres_config_default() {
        let config = PostgresConfig::default();
        assert_eq!(config.max_connections, 10);
        assert_eq!(config.min_connections, 2);
        assert_eq!(config.acquire_timeout, Duration::from_secs(3));
        assert_eq!(config.idle_timeout, Duration::from_secs(600));
        assert_eq!(config.max_lifetime, Duration::from_secs(1800));
    }

    #[test]
    fn test_postgres_config_custom() {
        let config = PostgresConfig {
            max_connections: 20,
            min_connections: 5,
            acquire_timeout: Duration::from_secs(10),
            idle_timeout: Duration::from_secs(300),
            max_lifetime: Duration::from_secs(3600),
        };
        assert_eq!(config.max_connections, 20);
        assert_eq!(config.min_connections, 5);
        assert_eq!(config.acquire_timeout, Duration::from_secs(10));
        assert_eq!(config.idle_timeout, Duration::from_secs(300));
        assert_eq!(config.max_lifetime, Duration::from_secs(3600));
    }
}
