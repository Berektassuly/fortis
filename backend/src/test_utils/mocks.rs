//! Mock implementations for testing.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::domain::{
    AppError, BlockchainClient, BlockchainError, BlockchainStatus, BlockchainSubmission,
    ComplianceDecision, ComplianceLevel, ComplianceProvider, ComplianceStatus, DatabaseClient,
    DatabaseError, PaginatedResponse, SubmitTransferRequest, TokenizeListingRequest,
    TokenizeListingResult, TransactionStatus, TransferRequest, WalletApproval,
    WalletApprovalStatus, WalletApprovalSubmission,
};

/// Configuration for mock behavior
#[derive(Debug, Clone, Default)]
pub struct MockConfig {
    pub should_fail: bool,
    pub error_message: Option<String>,
}

impl MockConfig {
    #[must_use]
    pub fn success() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn failure(message: impl Into<String>) -> Self {
        Self {
            should_fail: true,
            error_message: Some(message.into()),
        }
    }
}

/// Mock database client for testing
pub struct MockDatabaseClient {
    storage: Arc<Mutex<HashMap<String, TransferRequest>>>,
    wallet_approvals: Arc<Mutex<HashMap<String, WalletApproval>>>,
    config: MockConfig,
    is_healthy: AtomicBool,
}

impl MockDatabaseClient {
    #[must_use]
    pub fn new() -> Self {
        Self::with_config(MockConfig::success())
    }

    #[must_use]
    pub fn with_config(config: MockConfig) -> Self {
        Self {
            storage: Arc::new(Mutex::new(HashMap::new())),
            wallet_approvals: Arc::new(Mutex::new(HashMap::new())),
            config,
            is_healthy: AtomicBool::new(true),
        }
    }

    #[must_use]
    pub fn failing(message: impl Into<String>) -> Self {
        Self::with_config(MockConfig::failure(message))
    }

    pub fn set_healthy(&self, healthy: bool) {
        self.is_healthy.store(healthy, Ordering::Relaxed);
    }

    /// Get all stored items (for testing)
    pub fn get_all_items(&self) -> Vec<TransferRequest> {
        self.storage.lock().unwrap().values().cloned().collect()
    }

    fn check_should_fail(&self) -> Result<(), AppError> {
        if self.config.should_fail {
            let msg = self
                .config
                .error_message
                .clone()
                .unwrap_or_else(|| "Mock error".to_string());
            return Err(AppError::Database(DatabaseError::Query(msg)));
        }
        Ok(())
    }
}

impl Default for MockDatabaseClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DatabaseClient for MockDatabaseClient {
    async fn health_check(&self) -> Result<(), AppError> {
        if !self.is_healthy.load(Ordering::Relaxed) {
            return Err(AppError::Database(DatabaseError::Connection(
                "Unhealthy".to_string(),
            )));
        }
        self.check_should_fail()
    }

    async fn get_transfer_request(&self, id: &str) -> Result<Option<TransferRequest>, AppError> {
        self.check_should_fail()?;
        let storage = self.storage.lock().unwrap();
        Ok(storage.get(id).cloned())
    }

    async fn submit_transfer(
        &self,
        data: &SubmitTransferRequest,
    ) -> Result<TransferRequest, AppError> {
        self.check_should_fail()?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        // Simulating compliance check (default to Pending or Mock logic)
        let compliance_status = ComplianceStatus::Pending; // Or Approved if we want to simulate auto-approve

        let request = TransferRequest {
            id: id.clone(),
            from_address: data.from_address.clone(),
            to_address: data.to_address.clone(),
            source_owner_address: data.source_owner_address.clone(),
            transfer_details: data.transfer_details.clone(),
            token_mint: data.token_mint.clone(),
            asset_record_pda: None,
            sender_compliance_pda: None,
            receiver_compliance_pda: None,
            range_risk_score: None,
            range_risk_level: None,
            range_reasoning: None,
            compliance_status,
            blockchain_status: BlockchainStatus::Received,
            blockchain_signature: None,
            blockchain_retry_count: 0,
            blockchain_last_error: None,
            blockchain_next_retry_at: None,
            // Jito Double Spend Protection fields
            original_tx_signature: None,
            last_error_type: crate::domain::LastErrorType::None,
            blockhash_used: None,
            // Request Uniqueness fields
            nonce: Some(data.nonce.clone()),
            client_signature: Some(data.signature.clone()),
            created_at: now,
            updated_at: now,
        };
        let mut storage = self.storage.lock().unwrap();
        storage.insert(id, request.clone());
        Ok(request)
    }

    async fn mark_transfer_approved(
        &self,
        id: &str,
        decision: &ComplianceDecision,
        approval: &WalletApproval,
    ) -> Result<(), AppError> {
        self.check_should_fail()?;
        let mut storage = self.storage.lock().unwrap();
        if let Some(item) = storage.get_mut(id) {
            item.compliance_status = decision.status;
            item.asset_record_pda = Some(approval.asset_record_pda.clone());
            item.receiver_compliance_pda = Some(approval.compliance_record_pda.clone());
            item.range_risk_score = decision.risk_score;
            item.range_risk_level = decision.risk_level.clone();
            item.range_reasoning = decision.reasoning.clone();
            item.updated_at = Utc::now();
        }
        Ok(())
    }

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

    async fn list_transfer_requests(
        &self,
        limit: i64,
        cursor: Option<&str>,
    ) -> Result<PaginatedResponse<TransferRequest>, AppError> {
        self.check_should_fail()?;
        let storage = self.storage.lock().unwrap();
        let mut items: Vec<TransferRequest> = storage.values().cloned().collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        // Apply cursor
        let items = if let Some(cursor_id) = cursor {
            let pos = items.iter().position(|i| i.id == cursor_id);
            match pos {
                Some(p) => items.into_iter().skip(p + 1).collect(),
                None => {
                    return Err(AppError::Validation(
                        crate::domain::ValidationError::InvalidField {
                            field: "cursor".to_string(),
                            message: "Invalid cursor".to_string(),
                        },
                    ));
                }
            }
        } else {
            items
        };

        let limit = limit.clamp(1, 100) as usize;
        let has_more = items.len() > limit;
        let items: Vec<TransferRequest> = items.into_iter().take(limit).collect();
        let next_cursor = if has_more {
            items.last().map(|i| i.id.clone())
        } else {
            None
        };

        Ok(PaginatedResponse::new(items, next_cursor, has_more))
    }

    async fn update_blockchain_status(
        &self,
        id: &str,
        status: BlockchainStatus,
        signature: Option<&str>,
        error: Option<&str>,
        next_retry_at: Option<DateTime<Utc>>,
        blockhash_used: Option<&str>,
    ) -> Result<(), AppError> {
        self.check_should_fail()?;
        let mut storage = self.storage.lock().unwrap();
        if let Some(item) = storage.get_mut(id) {
            item.blockchain_status = status;
            if let Some(sig) = signature {
                item.blockchain_signature = Some(sig.to_string());
            }
            item.blockchain_last_error = error.map(|e| e.to_string());
            item.blockchain_next_retry_at = next_retry_at;
            if let Some(bh) = blockhash_used {
                item.blockhash_used = Some(bh.to_string());
            }
            item.updated_at = Utc::now();
        }
        Ok(())
    }

    async fn update_compliance_status(
        &self,
        id: &str,
        status: ComplianceStatus,
    ) -> Result<(), AppError> {
        self.check_should_fail()?;
        let mut storage = self.storage.lock().unwrap();
        if let Some(item) = storage.get_mut(id) {
            item.compliance_status = status;
            item.updated_at = Utc::now();
        }
        Ok(())
    }

    async fn enqueue_wallet_approval_if_missing(
        &self,
        token_mint: &str,
        wallet_address: &str,
        decision: &ComplianceDecision,
    ) -> Result<WalletApproval, AppError> {
        self.check_should_fail()?;
        let key = format!("{}:{}", wallet_address, token_mint);
        let mut approvals = self.wallet_approvals.lock().unwrap();
        if let Some(existing) = approvals.get(&key) {
            return Ok(existing.clone());
        }

        let now = Utc::now();
        let approval = WalletApproval {
            id: Uuid::new_v4().to_string(),
            wallet_address: wallet_address.to_string(),
            token_mint: token_mint.to_string(),
            asset_record_pda: format!("asset_pda_{}", token_mint),
            compliance_record_pda: format!("compliance_pda_{}_{}", token_mint, wallet_address),
            compliance_level: decision.level,
            range_risk_score: decision.risk_score,
            range_risk_level: decision.risk_level.clone(),
            range_reasoning: decision.reasoning.clone(),
            anchor_tx_signature: None,
            anchor_status: WalletApprovalStatus::Received,
            retry_count: 0,
            last_error: None,
            next_retry_at: None,
            approved_at: None,
            expires_at: None,
            created_at: now,
            updated_at: now,
        };
        approvals.insert(key, approval.clone());
        Ok(approval)
    }

    async fn get_pending_wallet_approvals(
        &self,
        limit: i64,
    ) -> Result<Vec<WalletApproval>, AppError> {
        self.check_should_fail()?;
        let mut approvals = self.wallet_approvals.lock().unwrap();
        let now = Utc::now();
        let mut claimed = Vec::new();

        for approval in approvals.values_mut() {
            if claimed.len() >= limit as usize {
                break;
            }
            if approval.anchor_status == WalletApprovalStatus::Received
                && approval.next_retry_at.map(|t| t <= now).unwrap_or(true)
            {
                approval.anchor_status = WalletApprovalStatus::Processing;
                approval.updated_at = now;
                claimed.push(approval.clone());
            }
        }

        claimed.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(claimed)
    }

    async fn update_wallet_approval_status(
        &self,
        id: &str,
        status: WalletApprovalStatus,
        signature: Option<&str>,
        error: Option<&str>,
        next_retry_at: Option<DateTime<Utc>>,
        approved_at: Option<DateTime<Utc>>,
    ) -> Result<(), AppError> {
        self.check_should_fail()?;
        let mut approvals = self.wallet_approvals.lock().unwrap();
        if let Some(approval) = approvals.values_mut().find(|approval| approval.id == id) {
            approval.anchor_status = status;
            if let Some(signature) = signature {
                approval.anchor_tx_signature = Some(signature.to_string());
            }
            approval.last_error = error.map(str::to_string);
            approval.next_retry_at = next_retry_at;
            approval.approved_at = approved_at;
            approval.updated_at = Utc::now();
        }
        Ok(())
    }

    async fn increment_wallet_approval_retry_count(&self, id: &str) -> Result<i32, AppError> {
        self.check_should_fail()?;
        let mut approvals = self.wallet_approvals.lock().unwrap();
        if let Some(approval) = approvals.values_mut().find(|approval| approval.id == id) {
            approval.retry_count += 1;
            approval.updated_at = Utc::now();
            Ok(approval.retry_count)
        } else {
            Err(AppError::Database(DatabaseError::NotFound(id.to_string())))
        }
    }

    async fn fail_transfers_waiting_for_wallet_approval(
        &self,
        wallet_address: &str,
        token_mint: &str,
        error: &str,
    ) -> Result<u64, AppError> {
        self.check_should_fail()?;
        let mut storage = self.storage.lock().unwrap();
        let mut updated = 0;

        for item in storage.values_mut() {
            let is_waiting_for_approval = item.to_address == wallet_address
                && item.token_mint.as_deref() == Some(token_mint)
                && matches!(
                    item.blockchain_status,
                    BlockchainStatus::Received
                        | BlockchainStatus::Pending
                        | BlockchainStatus::PendingSubmission
                        | BlockchainStatus::Processing
                );

            if is_waiting_for_approval {
                item.blockchain_status = BlockchainStatus::Failed;
                item.blockchain_last_error = Some(error.to_string());
                item.blockchain_next_retry_at = None;
                item.updated_at = Utc::now();
                updated += 1;
            }
        }

        Ok(updated)
    }

    /// Mock atomic claim: returns items with Processing status (like the real implementation)
    async fn get_pending_blockchain_requests(
        &self,
        limit: i64,
    ) -> Result<Vec<TransferRequest>, AppError> {
        self.check_should_fail()?;
        let mut storage = self.storage.lock().unwrap();
        let now = Utc::now();

        // Find eligible items
        let eligible_ids: Vec<String> = storage
            .values()
            .filter(|i| {
                let approval_is_ready = i.token_mint.as_ref().is_some_and(|mint| {
                    self.wallet_approvals
                        .lock()
                        .unwrap()
                        .values()
                        .any(|approval| {
                            approval.wallet_address == i.to_address
                                && approval.token_mint == *mint
                                && approval.anchor_status == WalletApprovalStatus::Approved
                        })
                });
                i.blockchain_status == BlockchainStatus::PendingSubmission
                    && i.compliance_status == ComplianceStatus::Approved
                    && approval_is_ready
                    && i.blockchain_retry_count < 10
                    && i.blockchain_next_retry_at.map(|t| t <= now).unwrap_or(true)
            })
            .take(limit as usize)
            .map(|i| i.id.clone())
            .collect();

        // Atomically update status to Processing and return claimed items
        let mut claimed_items = Vec::new();
        for id in eligible_ids {
            if let Some(item) = storage.get_mut(&id) {
                item.blockchain_status = BlockchainStatus::Processing;
                item.updated_at = Utc::now();
                claimed_items.push(item.clone());
            }
        }

        claimed_items.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(claimed_items)
    }

    async fn increment_retry_count(&self, id: &str) -> Result<i32, AppError> {
        self.check_should_fail()?;
        let mut storage = self.storage.lock().unwrap();
        if let Some(item) = storage.get_mut(id) {
            item.blockchain_retry_count += 1;
            item.updated_at = Utc::now();
            Ok(item.blockchain_retry_count)
        } else {
            Err(AppError::Database(DatabaseError::NotFound(id.to_string())))
        }
    }

    async fn get_transfer_by_signature(
        &self,
        signature: &str,
    ) -> Result<Option<TransferRequest>, AppError> {
        self.check_should_fail()?;
        let storage = self.storage.lock().unwrap();
        Ok(storage
            .values()
            .find(|req| req.blockchain_signature.as_deref() == Some(signature))
            .cloned())
    }

    async fn get_stale_submitted_transactions(
        &self,
        _older_than_secs: i64,
        limit: i64,
    ) -> Result<Vec<TransferRequest>, AppError> {
        self.check_should_fail()?;
        let storage = self.storage.lock().unwrap();
        let mut items: Vec<_> = storage
            .values()
            .filter(|req| req.blockchain_status == BlockchainStatus::Submitted)
            .take(limit as usize)
            .cloned()
            .collect();
        items.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(items)
    }
}

/// Mock blockchain client for testing
pub struct MockBlockchainClient {
    transactions: Arc<Mutex<Vec<String>>>,
    config: MockConfig,
    is_healthy: AtomicBool,
    submission_status: Arc<Mutex<BlockchainStatus>>,
    signature_status: Arc<Mutex<Option<TransactionStatus>>>,
    blockhash_valid: AtomicBool,
}

impl MockBlockchainClient {
    #[must_use]
    pub fn new() -> Self {
        Self::with_config(MockConfig::success())
    }

    #[must_use]
    pub fn with_config(config: MockConfig) -> Self {
        Self {
            transactions: Arc::new(Mutex::new(Vec::new())),
            config,
            is_healthy: AtomicBool::new(true),
            submission_status: Arc::new(Mutex::new(BlockchainStatus::Submitted)),
            signature_status: Arc::new(Mutex::new(None)),
            blockhash_valid: AtomicBool::new(true),
        }
    }

    #[must_use]
    pub fn failing(message: impl Into<String>) -> Self {
        Self::with_config(MockConfig::failure(message))
    }

    pub fn set_healthy(&self, healthy: bool) {
        self.is_healthy.store(healthy, Ordering::Relaxed);
    }

    pub fn get_transactions(&self) -> Vec<String> {
        self.transactions.lock().unwrap().clone()
    }

    pub fn set_submission_status(&self, status: BlockchainStatus) {
        *self.submission_status.lock().unwrap() = status;
    }

    pub fn set_signature_status(&self, status: Option<TransactionStatus>) {
        *self.signature_status.lock().unwrap() = status;
    }

    pub fn set_blockhash_valid(&self, valid: bool) {
        self.blockhash_valid.store(valid, Ordering::Relaxed);
    }

    fn check_should_fail(&self) -> Result<(), AppError> {
        if self.config.should_fail {
            let msg = self
                .config
                .error_message
                .clone()
                .unwrap_or_else(|| "Mock error".to_string());
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                msg,
            )));
        }
        Ok(())
    }
}

impl Default for MockBlockchainClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BlockchainClient for MockBlockchainClient {
    async fn health_check(&self) -> Result<(), AppError> {
        if !self.is_healthy.load(Ordering::Relaxed) {
            return Err(AppError::Blockchain(BlockchainError::Connection(
                "Unhealthy".to_string(),
            )));
        }
        self.check_should_fail()
    }

    async fn submit_transaction(
        &self,
        request: &TransferRequest,
    ) -> Result<BlockchainSubmission, AppError> {
        self.check_should_fail()?;
        // Mock signature generation (e.g., hash of ID)
        let signature = format!("sig_{}", request.id);
        let blockhash = "mock_blockhash_abc123".to_string();
        let mut transactions = self.transactions.lock().unwrap();
        transactions.push(request.id.clone());
        Ok(BlockchainSubmission {
            signature,
            blockhash,
            status: *self.submission_status.lock().unwrap(),
        })
    }

    async fn get_transaction_status(&self, _signature: &str) -> Result<bool, AppError> {
        self.check_should_fail()?;
        // For mock purposes, assume if it's in our list it's valid
        // But here we store request IDs, not signatures.
        // Let's simplified assumption: always true if not failing
        Ok(true)
    }

    async fn get_latest_blockhash(&self) -> Result<String, AppError> {
        self.check_should_fail()?;
        Ok("mock_blockhash_abc123".to_string())
    }

    async fn transfer_sol(
        &self,
        to_address: &str,
        amount_lamports: u64,
    ) -> Result<(String, String), AppError> {
        self.check_should_fail()?;
        let signature = format!(
            "transfer_sig_{}_{}",
            &to_address[..8.min(to_address.len())],
            amount_lamports
        );
        let blockhash = "mock_blockhash_sol_transfer".to_string();
        let mut transactions = self.transactions.lock().unwrap();
        transactions.push(format!("transfer:{}:{}", to_address, amount_lamports));
        Ok((signature, blockhash))
    }

    async fn transfer_token(
        &self,
        to_address: &str,
        token_mint: &str,
        amount: u64,
    ) -> Result<(String, String), AppError> {
        self.check_should_fail()?;
        let mint_prefix = &token_mint[..8.min(token_mint.len())];
        let signature = format!("token_sig_{}_{}", mint_prefix, amount);
        let blockhash = "mock_blockhash_token_transfer".to_string();
        let mut transactions = self.transactions.lock().unwrap();
        transactions.push(format!(
            "token_transfer:{}:{}:{}",
            to_address, token_mint, amount
        ));
        Ok((signature, blockhash))
    }

    async fn approve_wallet(
        &self,
        token_mint: &str,
        wallet_address: &str,
        _compliance_level: ComplianceLevel,
    ) -> Result<WalletApprovalSubmission, AppError> {
        self.check_should_fail()?;
        let mut transactions = self.transactions.lock().unwrap();
        transactions.push(format!("approve_wallet:{}:{}", token_mint, wallet_address));
        Ok(WalletApprovalSubmission {
            asset_record_pda: format!("asset_pda_{}", token_mint),
            compliance_record_pda: format!("compliance_pda_{}_{}", token_mint, wallet_address),
            tx_signature: Some(format!(
                "approve_sig_{}",
                &token_mint[..8.min(token_mint.len())]
            )),
        })
    }

    async fn get_signature_status(
        &self,
        _signature: &str,
    ) -> Result<Option<TransactionStatus>, AppError> {
        self.check_should_fail()?;
        Ok(self.signature_status.lock().unwrap().clone())
    }

    async fn is_blockhash_valid(&self, _blockhash: &str) -> Result<bool, AppError> {
        self.check_should_fail()?;
        Ok(self.blockhash_valid.load(Ordering::Relaxed))
    }

    async fn tokenize_listing(
        &self,
        request: &TokenizeListingRequest,
    ) -> Result<TokenizeListingResult, AppError> {
        self.check_should_fail()?;
        let mint_seed = request
            .listing_id
            .to_string()
            .chars()
            .take(8)
            .collect::<String>()
            .to_lowercase();
        let mut transactions = self.transactions.lock().unwrap();
        transactions.push(format!(
            "tokenize_listing:{}:{}:{}",
            request.listing_id, request.seller_wallet_address, request.planned_supply
        ));

        Ok(TokenizeListingResult {
            token_mint_address: format!("mint_{}", mint_seed),
            asset_record_pda: format!("asset_pda_{}", mint_seed),
            seller_compliance_record_pda: format!("seller_compliance_{}", mint_seed),
            delegate_wallet_address: "fortis_delegate_wallet".to_string(),
            planned_supply: request.planned_supply,
            initialize_mint_signature: Some(format!("sig_init_mint_{}", mint_seed)),
            initialize_asset_signature: Some(format!("sig_init_asset_{}", mint_seed)),
            mint_to_signature: Some(format!("sig_mint_to_{}", mint_seed)),
        })
    }
}

/// Mock compliance provider for testing
pub struct MockComplianceProvider {
    config: MockConfig,
}

impl MockComplianceProvider {
    pub fn new() -> Self {
        Self {
            config: MockConfig::success(),
        }
    }

    pub fn failing(message: impl Into<String>) -> Self {
        Self {
            config: MockConfig::failure(message),
        }
    }
}

impl Default for MockComplianceProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ComplianceProvider for MockComplianceProvider {
    async fn screen_wallet(&self, wallet_address: &str) -> Result<ComplianceDecision, AppError> {
        if self.config.should_fail {
            return Err(AppError::ExternalService(
                crate::domain::ExternalServiceError::HttpError(
                    self.config.error_message.clone().unwrap_or_default(),
                ),
            ));
        }

        if wallet_address.to_lowercase().starts_with("hack") {
            return Ok(ComplianceDecision::rejected(
                Some(10),
                Some("Critical risk".to_string()),
                Some("Mock compliance provider rejected the wallet".to_string()),
            ));
        }

        Ok(ComplianceDecision::approved(
            ComplianceLevel::Standard,
            Some(2),
            Some("Low risk".to_string()),
            Some("Mock approval".to_string()),
        ))
    }
}
