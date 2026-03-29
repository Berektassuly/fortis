//! Domain traits defining contracts for external systems.

use async_trait::async_trait;

use super::error::AppError;
use super::types::{
    BlockchainStatus, ComplianceDecision, ComplianceLevel, LastErrorType, PaginatedResponse,
    SubmitTransferRequest, TokenizeListingRequest, TokenizeListingResult, TransactionStatus,
    TransferRequest, WalletApproval, WalletApprovalStatus, WalletApprovalSubmission,
    WalletRiskProfile,
};
use chrono::{DateTime, Utc};

/// Compliance provider trait for screening requests
#[async_trait]
pub trait ComplianceProvider: Send + Sync {
    /// Screen a wallet and return the decision used for wallet approval.
    async fn screen_wallet(&self, wallet_address: &str) -> Result<ComplianceDecision, AppError>;
}

/// Database client trait for persistence operations
#[async_trait]
pub trait DatabaseClient: Send + Sync {
    /// Check database connectivity
    async fn health_check(&self) -> Result<(), AppError>;

    /// Get a single transfer request by ID
    async fn get_transfer_request(&self, id: &str) -> Result<Option<TransferRequest>, AppError>;

    /// Submit a new transfer request
    async fn submit_transfer(
        &self,
        data: &SubmitTransferRequest,
    ) -> Result<TransferRequest, AppError>;

    /// Persist an approval decision and transfer-level audit snapshot.
    async fn mark_transfer_approved(
        &self,
        id: &str,
        decision: &ComplianceDecision,
        approval: &WalletApproval,
    ) -> Result<(), AppError>;

    /// Queue a transfer for background submission after approval is ready.
    async fn enqueue_transfer_submission(&self, id: &str) -> Result<(), AppError>;

    /// List transfer requests with cursor-based pagination
    async fn list_transfer_requests(
        &self,
        limit: i64,
        cursor: Option<&str>,
    ) -> Result<PaginatedResponse<TransferRequest>, AppError>;

    /// Update blockchain status for a transfer request.
    /// When signature is set, blockhash_used can be set for Jito double-spend protection (expiry checks).
    async fn update_blockchain_status(
        &self,
        id: &str,
        status: BlockchainStatus,
        signature: Option<&str>,
        error: Option<&str>,
        next_retry_at: Option<DateTime<Utc>>,
        blockhash_used: Option<&str>,
    ) -> Result<(), AppError>;

    /// Update compliance status for a transfer request
    async fn update_compliance_status(
        &self,
        id: &str,
        status: crate::domain::ComplianceStatus,
    ) -> Result<(), AppError>;

    /// Insert or refresh a wallet approval job without duplicating work.
    async fn enqueue_wallet_approval_if_missing(
        &self,
        token_mint: &str,
        wallet_address: &str,
        decision: &ComplianceDecision,
    ) -> Result<WalletApproval, AppError>;

    /// Claim wallet approvals that are ready for processing.
    async fn get_pending_wallet_approvals(&self, limit: i64) -> Result<Vec<WalletApproval>, AppError>;

    /// Update wallet approval processing state.
    async fn update_wallet_approval_status(
        &self,
        id: &str,
        status: WalletApprovalStatus,
        signature: Option<&str>,
        error: Option<&str>,
        next_retry_at: Option<DateTime<Utc>>,
        approved_at: Option<DateTime<Utc>>,
    ) -> Result<(), AppError>;

    /// Increment retry count for a wallet approval job.
    async fn increment_wallet_approval_retry_count(&self, id: &str) -> Result<i32, AppError>;

    /// Get requests pending blockchain submission
    async fn get_pending_blockchain_requests(
        &self,
        limit: i64,
    ) -> Result<Vec<TransferRequest>, AppError>;

    /// Increment retry count for a request
    async fn increment_retry_count(&self, id: &str) -> Result<i32, AppError>;

    /// Get a transfer request by blockchain signature
    async fn get_transfer_by_signature(
        &self,
        signature: &str,
    ) -> Result<Option<TransferRequest>, AppError>;

    // =========================================================================
    // Request Uniqueness Methods (Replay Protection & Idempotency)
    // =========================================================================

    /// Find an existing request by from_address and nonce.
    /// Used to check for duplicate requests (idempotency) and prevent replay attacks.
    ///
    /// # Arguments
    /// * `from_address` - The sender's wallet address (optional for broader lookups)
    /// * `nonce` - The unique nonce from the request
    ///
    /// # Returns
    /// - `Ok(Some(TransferRequest))` - Existing request found with this nonce
    /// - `Ok(None)` - No existing request with this nonce
    async fn find_by_nonce(
        &self,
        from_address: &str,
        nonce: &str,
    ) -> Result<Option<TransferRequest>, AppError> {
        let _ = (from_address, nonce);
        Ok(None)
    }

    // =========================================================================
    // Jito Double Spend Protection Methods
    // =========================================================================

    /// Update Jito tracking fields for a transfer request.
    /// Used to store the original signature, error type, and blockhash for safe retry logic.
    async fn update_jito_tracking(
        &self,
        id: &str,
        original_tx_signature: Option<&str>,
        last_error_type: LastErrorType,
        blockhash_used: Option<&str>,
    ) -> Result<(), AppError> {
        let _ = (id, original_tx_signature, last_error_type, blockhash_used);
        Ok(())
    }

    // =========================================================================
    // Active Polling Fallback (Crank) Methods
    // =========================================================================

    /// Get transactions stuck in `submitted` state for longer than the specified duration.
    /// Used by the active polling fallback (crank) to detect stale transactions
    /// that may not have received webhook confirmation.
    ///
    /// # Arguments
    /// * `older_than_secs` - Only return transactions with `updated_at` older than this many seconds
    /// * `limit` - Maximum number of transactions to return
    ///
    /// # Returns
    /// Transactions in `submitted` status that haven't been updated recently.
    /// The crank should check their on-chain status via `getSignatureStatuses`.
    async fn get_stale_submitted_transactions(
        &self,
        older_than_secs: i64,
        limit: i64,
    ) -> Result<Vec<TransferRequest>, AppError> {
        let _ = (older_than_secs, limit);
        Ok(vec![])
    }

    // =========================================================================
    // Risk Profile Methods (for pre-flight compliance screening cache)
    // =========================================================================

    /// Get a cached risk profile for a wallet address.
    /// Returns None if not cached or cache expired (updated_at older than max_age_secs).
    async fn get_risk_profile(
        &self,
        address: &str,
        max_age_secs: i64,
    ) -> Result<Option<WalletRiskProfile>, AppError> {
        let _ = (address, max_age_secs);
        Ok(None)
    }

    /// Upsert a risk profile for a wallet address.
    async fn upsert_risk_profile(&self, profile: &WalletRiskProfile) -> Result<(), AppError> {
        let _ = profile;
        Ok(())
    }
}

/// Blockchain client trait for chain operations
#[async_trait]
pub trait BlockchainClient: Send + Sync {
    /// Check blockchain RPC connectivity
    async fn health_check(&self) -> Result<(), AppError>;

    /// Submit a transaction using the transfer request details.
    /// Returns (signature, blockhash) for Jito double-spend protection (blockhash used for expiry checks).
    async fn submit_transaction(
        &self,
        request: &TransferRequest,
    ) -> Result<(String, String), AppError>;

    /// Get transaction confirmation status
    async fn get_transaction_status(&self, signature: &str) -> Result<bool, AppError> {
        let _ = signature;
        Err(AppError::NotSupported(
            "get_transaction_status not implemented".to_string(),
        ))
    }

    /// Get current block height
    async fn get_block_height(&self) -> Result<u64, AppError> {
        Err(AppError::NotSupported(
            "get_block_height not implemented".to_string(),
        ))
    }

    /// Get latest blockhash for transaction construction
    async fn get_latest_blockhash(&self) -> Result<String, AppError> {
        Err(AppError::NotSupported(
            "get_latest_blockhash not implemented".to_string(),
        ))
    }

    /// Wait for transaction confirmation with timeout
    async fn wait_for_confirmation(
        &self,
        signature: &str,
        timeout_secs: u64,
    ) -> Result<bool, AppError> {
        let _ = (signature, timeout_secs);
        Err(AppError::NotSupported(
            "wait_for_confirmation not implemented".to_string(),
        ))
    }

    /// Transfer SOL from the issuer wallet to a destination address
    /// Amount is in lamports (1 SOL = 1_000_000_000 lamports)
    /// Returns (signature, blockhash) on success for Jito double-spend protection
    async fn transfer_sol(
        &self,
        to_address: &str,
        amount_lamports: u64,
    ) -> Result<(String, String), AppError> {
        let _ = (to_address, amount_lamports);
        Err(AppError::NotSupported(
            "transfer_sol not implemented".to_string(),
        ))
    }

    /// Transfer SPL Tokens from the issuer wallet to a destination address
    /// Creates the destination ATA if it doesn't exist
    /// Amount is in raw token units (caller must pre-convert using token decimals)
    /// Example: 1 USDC (6 decimals) = 1_000_000 raw units
    /// Returns (signature, blockhash) on success for Jito double-spend protection
    async fn transfer_token(
        &self,
        to_address: &str,
        token_mint: &str,
        amount: u64,
    ) -> Result<(String, String), AppError> {
        let _ = (to_address, token_mint, amount);
        Err(AppError::NotSupported(
            "transfer_token not implemented".to_string(),
        ))
    }

    /// Submit the Fortis RWA `approve_wallet` instruction to the Anchor program.
    async fn approve_wallet(
        &self,
        token_mint: &str,
        wallet_address: &str,
        compliance_level: ComplianceLevel,
    ) -> Result<WalletApprovalSubmission, AppError> {
        let _ = (token_mint, wallet_address, compliance_level);
        Err(AppError::NotSupported(
            "approve_wallet not implemented".to_string(),
        ))
    }

    /// Check if a wallet holds compliant assets using DAS (Digital Asset Standard).
    /// This is a Helius-specific feature for compliance screening.
    ///
    /// Returns `false` if the wallet holds assets from sanctioned collections.
    /// For non-Helius providers, returns `true` (skip check / assume compliant).
    ///
    /// # Arguments
    /// * `owner` - The wallet address (Base58) to check
    async fn check_wallet_assets(&self, owner: &str) -> Result<bool, AppError> {
        let _ = owner;
        // Default: skip check for providers without DAS support
        Ok(true)
    }

    /// Create a Token-2022 mint, register the Fortis asset metadata,
    /// mint the planned supply to the seller, and prepare delegated controls.
    async fn tokenize_listing(
        &self,
        request: &TokenizeListingRequest,
    ) -> Result<TokenizeListingResult, AppError> {
        let _ = request;
        Err(AppError::NotSupported(
            "tokenize_listing not implemented".to_string(),
        ))
    }

    // =========================================================================
    // Jito Double Spend Protection Methods
    // =========================================================================

    /// Query the status of a transaction by its signature.
    /// Used to verify if an original transaction was processed before retrying
    /// after a JitoStateUnknown error.
    ///
    /// # Returns
    /// - `Ok(Some(TransactionStatus::Confirmed))` - Transaction confirmed
    /// - `Ok(Some(TransactionStatus::Finalized))` - Transaction finalized
    /// - `Ok(Some(TransactionStatus::Failed(msg)))` - Transaction failed on-chain
    /// - `Ok(None)` - Transaction not found (may still be processing or never submitted)
    async fn get_signature_status(
        &self,
        signature: &str,
    ) -> Result<Option<TransactionStatus>, AppError> {
        let _ = signature;
        Err(AppError::NotSupported(
            "get_signature_status not implemented".to_string(),
        ))
    }

    /// Check if a blockhash is still valid (not expired).
    /// Blockhashes typically expire after ~150 slots (~1-2 minutes).
    ///
    /// If the blockhash is expired and the original transaction was not found,
    /// it's safe to retry with a new blockhash (the original tx cannot be
    /// processed anymore).
    ///
    /// # Returns
    /// - `Ok(true)` - Blockhash is still valid
    /// - `Ok(false)` - Blockhash has expired
    async fn is_blockhash_valid(&self, blockhash: &str) -> Result<bool, AppError> {
        let _ = blockhash;
        Err(AppError::NotSupported(
            "is_blockhash_valid not implemented".to_string(),
        ))
    }

    /// Classify a blockchain error into LastErrorType for retry logic.
    /// This helper method categorizes errors to determine safe retry strategies.
    fn classify_error(&self, error: &AppError) -> LastErrorType {
        match error {
            AppError::Blockchain(crate::domain::BlockchainError::JitoStateUnknown(_)) => {
                LastErrorType::JitoStateUnknown
            }
            AppError::Blockchain(crate::domain::BlockchainError::JitoBundleFailed(_)) => {
                LastErrorType::JitoBundleFailed
            }
            AppError::Blockchain(crate::domain::BlockchainError::TransactionFailed(_)) => {
                LastErrorType::TransactionFailed
            }
            AppError::Blockchain(
                crate::domain::BlockchainError::Connection(_)
                | crate::domain::BlockchainError::Timeout(_)
                | crate::domain::BlockchainError::RpcError(_)
                | crate::domain::BlockchainError::TimeoutWithBlockhash { .. }
                | crate::domain::BlockchainError::NetworkErrorWithBlockhash { .. },
            ) => LastErrorType::NetworkError,
            AppError::Validation(_) => LastErrorType::ValidationError,
            _ => LastErrorType::TransactionFailed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal implementation for testing default methods
    #[allow(dead_code)]
    struct MinimalDatabaseClient;

    #[async_trait]
    impl DatabaseClient for MinimalDatabaseClient {
        async fn health_check(&self) -> Result<(), AppError> {
            Ok(())
        }

        async fn get_transfer_request(
            &self,
            _id: &str,
        ) -> Result<Option<TransferRequest>, AppError> {
            Ok(None)
        }

        async fn submit_transfer(
            &self,
            _data: &SubmitTransferRequest,
        ) -> Result<TransferRequest, AppError> {
            Ok(TransferRequest::default())
        }

        async fn mark_transfer_approved(
            &self,
            _id: &str,
            _decision: &ComplianceDecision,
            _approval: &WalletApproval,
        ) -> Result<(), AppError> {
            Ok(())
        }

        async fn enqueue_transfer_submission(&self, _id: &str) -> Result<(), AppError> {
            Ok(())
        }

        async fn list_transfer_requests(
            &self,
            _limit: i64,
            _cursor: Option<&str>,
        ) -> Result<PaginatedResponse<TransferRequest>, AppError> {
            Ok(PaginatedResponse::empty())
        }

        async fn update_blockchain_status(
            &self,
            _id: &str,
            _status: BlockchainStatus,
            _signature: Option<&str>,
            _error: Option<&str>,
            _next_retry_at: Option<DateTime<Utc>>,
            _blockhash_used: Option<&str>,
        ) -> Result<(), AppError> {
            Ok(())
        }

        async fn update_compliance_status(
            &self,
            _id: &str,
            _status: crate::domain::ComplianceStatus,
        ) -> Result<(), AppError> {
            Ok(())
        }

        async fn enqueue_wallet_approval_if_missing(
            &self,
            _token_mint: &str,
            _wallet_address: &str,
            _decision: &ComplianceDecision,
        ) -> Result<WalletApproval, AppError> {
            Err(AppError::NotSupported(
                "wallet approvals not implemented in minimal client".to_string(),
            ))
        }

        async fn get_pending_wallet_approvals(
            &self,
            _limit: i64,
        ) -> Result<Vec<WalletApproval>, AppError> {
            Ok(vec![])
        }

        async fn update_wallet_approval_status(
            &self,
            _id: &str,
            _status: WalletApprovalStatus,
            _signature: Option<&str>,
            _error: Option<&str>,
            _next_retry_at: Option<DateTime<Utc>>,
            _approved_at: Option<DateTime<Utc>>,
        ) -> Result<(), AppError> {
            Ok(())
        }

        async fn increment_wallet_approval_retry_count(&self, _id: &str) -> Result<i32, AppError> {
            Ok(1)
        }

        async fn get_pending_blockchain_requests(
            &self,
            _limit: i64,
        ) -> Result<Vec<TransferRequest>, AppError> {
            Ok(vec![])
        }

        async fn increment_retry_count(&self, _id: &str) -> Result<i32, AppError> {
            Ok(1)
        }

        async fn get_transfer_by_signature(
            &self,
            _signature: &str,
        ) -> Result<Option<TransferRequest>, AppError> {
            Ok(None)
        }
    }

    struct MinimalBlockchainClient;

    #[async_trait]
    impl BlockchainClient for MinimalBlockchainClient {
        async fn health_check(&self) -> Result<(), AppError> {
            Ok(())
        }

        async fn submit_transaction(
            &self,
            _request: &TransferRequest,
        ) -> Result<(String, String), AppError> {
            Ok(("sig_123".to_string(), "blockhash_default".to_string()))
        }

        async fn tokenize_listing(
            &self,
            _request: &TokenizeListingRequest,
        ) -> Result<TokenizeListingResult, AppError> {
            Ok(TokenizeListingResult {
                token_mint_address: "mint_123".to_string(),
                asset_record_pda: "asset_pda_123".to_string(),
                seller_compliance_record_pda: "seller_compliance_123".to_string(),
                delegate_wallet_address: "delegate_wallet_123".to_string(),
                planned_supply: 1,
                initialize_mint_signature: Some("sig_init_mint".to_string()),
                initialize_asset_signature: Some("sig_init_asset".to_string()),
                mint_to_signature: Some("sig_mint_to".to_string()),
            })
        }
    }

    #[tokio::test]
    async fn test_blockchain_client_get_transaction_status_not_supported() {
        let client = MinimalBlockchainClient;
        let result = client.get_transaction_status("sig").await;
        assert!(matches!(result, Err(AppError::NotSupported(_))));
    }
}
