//! Domain types with validation support.

use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use solana_sdk::pubkey::Pubkey;
use utoipa::ToSchema;
use validator::Validate;

use crate::domain::AppError;

pub const FORTIS_RWA_PROGRAM_ID: &str = "8oiLUNoBU3CrpuR8HhRTCawWfDog8WbYkcX1PkqmGvpk";

fn parse_pubkey(value: &str, field: &str) -> Result<Pubkey, AppError> {
    value.parse::<Pubkey>().map_err(|e| {
        AppError::Validation(crate::domain::ValidationError::InvalidField {
            field: field.to_string(),
            message: format!("Invalid base58 pubkey: {}", e),
        })
    })
}

pub fn fortis_rwa_program_pubkey() -> Result<Pubkey, AppError> {
    parse_pubkey(FORTIS_RWA_PROGRAM_ID, "rwa_program_id")
}

pub fn derive_asset_record_pda(token_mint: &str) -> Result<String, AppError> {
    let program_id = fortis_rwa_program_pubkey()?;
    let mint = parse_pubkey(token_mint, "token_mint")?;
    Ok(
        Pubkey::find_program_address(&[b"asset", mint.as_ref()], &program_id)
            .0
            .to_string(),
    )
}

pub fn derive_compliance_record_pda(
    token_mint: &str,
    wallet_address: &str,
) -> Result<String, AppError> {
    let program_id = fortis_rwa_program_pubkey()?;
    let mint = parse_pubkey(token_mint, "token_mint")?;
    let wallet = parse_pubkey(wallet_address, "wallet_address")?;
    Ok(Pubkey::find_program_address(
        &[b"compliance", mint.as_ref(), wallet.as_ref()],
        &program_id,
    )
    .0
    .to_string())
}

/// Real-world asset category mirrored from the Anchor program enum order.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AssetType {
    #[default]
    RealEstate,
    Bond,
    Commodity,
    Equity,
    Other,
}

impl AssetType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::RealEstate => "real_estate",
            Self::Bond => "bond",
            Self::Commodity => "commodity",
            Self::Equity => "equity",
            Self::Other => "other",
        }
    }
}

impl std::str::FromStr for AssetType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "real_estate" => Ok(Self::RealEstate),
            "bond" => Ok(Self::Bond),
            "commodity" => Ok(Self::Commodity),
            "equity" => Ok(Self::Equity),
            "other" => Ok(Self::Other),
            _ => Err(format!("Invalid asset type: {}", s)),
        }
    }
}

impl std::fmt::Display for AssetType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Status of blockchain submission for a transfer
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BlockchainStatus {
    /// Initial state - request received and persisted, awaiting compliance check
    /// (Receive → Persist → Process pattern: persist BEFORE compliance)
    #[default]
    Received,
    /// Legacy initial state (kept for backward compatibility with existing DB rows)
    Pending,
    /// Waiting to be submitted to blockchain (queued for worker after compliance approval)
    PendingSubmission,
    /// Worker has claimed this task, processing in progress
    Processing,
    /// Transaction submitted, awaiting confirmation
    Submitted,
    /// Transaction confirmed on blockchain (finalized commitment)
    Confirmed,
    /// Submission failed after max retries
    Failed,
    /// Blockhash expired and transaction was not found on-chain.
    /// Terminal state - user must re-sign with a fresh nonce.
    Expired,
}

impl BlockchainStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Received => "received",
            Self::Pending => "pending",
            Self::PendingSubmission => "pending_submission",
            Self::Processing => "processing",
            Self::Submitted => "submitted",
            Self::Confirmed => "confirmed",
            Self::Failed => "failed",
            Self::Expired => "expired",
        }
    }

    /// Check if this is a terminal state (no further transitions possible)
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Confirmed | Self::Failed | Self::Expired)
    }
}

impl std::str::FromStr for BlockchainStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "received" => Ok(Self::Received),
            "pending" => Ok(Self::Pending),
            "pending_submission" => Ok(Self::PendingSubmission),
            "processing" => Ok(Self::Processing),
            "submitted" => Ok(Self::Submitted),
            "confirmed" => Ok(Self::Confirmed),
            "failed" => Ok(Self::Failed),
            "expired" => Ok(Self::Expired),
            _ => Err(format!("Invalid blockchain status: {}", s)),
        }
    }
}

impl std::fmt::Display for BlockchainStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Result of submitting a blockchain transaction.
///
/// Some providers submit asynchronously and return once the transaction is
/// accepted by the RPC node (`submitted`), while others block until the
/// transaction is already confirmed on-chain (`confirmed`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockchainSubmission {
    pub signature: String,
    pub blockhash: String,
    pub status: BlockchainStatus,
}

/// Compliance status for a transfer
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComplianceStatus {
    /// Initial state, waiting for compliance check
    #[default]
    Pending,
    /// Compliance check passed
    Approved,
    /// Compliance check failed
    Rejected,
}

impl ComplianceStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }
}

impl std::str::FromStr for ComplianceStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "approved" => Ok(Self::Approved),
            "rejected" => Ok(Self::Rejected),
            _ => Err(format!("Invalid compliance status: {}", s)),
        }
    }
}

impl std::fmt::Display for ComplianceStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// ============================================================================
// Jito Double Spend Protection Types
// ============================================================================

/// Classification of the last error encountered during blockchain submission.
/// Used for smart retry logic to prevent double-spend on JitoStateUnknown.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LastErrorType {
    /// No error or initial state
    #[default]
    None,
    /// Jito bundle state unknown - DO NOT retry with new blockhash without checking status first.
    /// This occurs on timeouts, server errors, or ambiguous responses where the bundle
    /// may have been processed.
    JitoStateUnknown,
    /// Jito bundle definitively failed - safe to retry with new blockhash.
    /// The bundle was rejected/dropped and was NOT processed.
    JitoBundleFailed,
    /// Transaction failed on-chain or during deterministic simulation.
    /// Retrying with a new blockhash is double-spend safe, but not necessarily useful.
    TransactionFailed,
    /// Network/connection error - safe to retry with new blockhash.
    NetworkError,
    /// Validation error - should not retry automatically.
    ValidationError,
}

impl LastErrorType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::JitoStateUnknown => "jito_state_unknown",
            Self::JitoBundleFailed => "jito_bundle_failed",
            Self::TransactionFailed => "transaction_failed",
            Self::NetworkError => "network_error",
            Self::ValidationError => "validation_error",
        }
    }

    /// Check if this error type requires status verification before retry
    pub fn requires_status_check(&self) -> bool {
        matches!(self, Self::JitoStateUnknown)
    }

    /// Check if this error type is safe to retry with a new blockhash
    pub fn safe_to_retry_new_blockhash(&self) -> bool {
        matches!(
            self,
            Self::None | Self::JitoBundleFailed | Self::TransactionFailed | Self::NetworkError
        )
    }

    /// Check if the worker should retry automatically without operator intervention.
    pub fn should_auto_retry(&self) -> bool {
        matches!(
            self,
            Self::JitoStateUnknown | Self::JitoBundleFailed | Self::NetworkError
        )
    }
}

impl std::str::FromStr for LastErrorType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "none" => Ok(Self::None),
            "jito_state_unknown" => Ok(Self::JitoStateUnknown),
            "jito_bundle_failed" => Ok(Self::JitoBundleFailed),
            "transaction_failed" => Ok(Self::TransactionFailed),
            "network_error" => Ok(Self::NetworkError),
            "validation_error" => Ok(Self::ValidationError),
            _ => Err(format!("Invalid last error type: {}", s)),
        }
    }
}

impl std::fmt::Display for LastErrorType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Transaction status from blockchain query.
/// Used to determine if an original transaction was processed before retrying.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransactionStatus {
    /// Transaction is confirmed (1+ confirmations)
    Confirmed,
    /// Transaction is finalized (max confirmations)
    Finalized,
    /// Transaction failed with an error
    Failed(String),
}

/// Type of transfer and associated data
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransferType {
    /// Standard public transfer with visible amount
    Public {
        /// Amount in atomic units
        #[schema(example = 1)]
        amount: u64,
    },
}

/// Compliance level persisted for wallet approvals and on-chain audit data.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComplianceLevel {
    Basic,
    #[default]
    Standard,
    Enhanced,
}

impl ComplianceLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Basic => "basic",
            Self::Standard => "standard",
            Self::Enhanced => "enhanced",
        }
    }
}

impl std::str::FromStr for ComplianceLevel {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "basic" => Ok(Self::Basic),
            "standard" => Ok(Self::Standard),
            "enhanced" => Ok(Self::Enhanced),
            _ => Err(format!("Invalid compliance level: {}", s)),
        }
    }
}

impl std::fmt::Display for ComplianceLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Wallet-centric screening result used to drive Fortis RWA approvals.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct ComplianceDecision {
    pub status: ComplianceStatus,
    pub level: ComplianceLevel,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub risk_score: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub risk_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reasoning: Option<String>,
}

impl ComplianceDecision {
    #[must_use]
    pub fn approved(
        level: ComplianceLevel,
        risk_score: Option<i32>,
        risk_level: Option<String>,
        reasoning: Option<String>,
    ) -> Self {
        Self {
            status: ComplianceStatus::Approved,
            level,
            risk_score,
            risk_level,
            reasoning,
        }
    }

    #[must_use]
    pub fn rejected(
        risk_score: Option<i32>,
        risk_level: Option<String>,
        reasoning: Option<String>,
    ) -> Self {
        Self {
            status: ComplianceStatus::Rejected,
            level: ComplianceLevel::Enhanced,
            risk_score,
            risk_level,
            reasoning,
        }
    }
}

/// Status of a queued wallet approval transaction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WalletApprovalStatus {
    #[default]
    Received,
    Processing,
    Approved,
    Failed,
}

impl WalletApprovalStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Received => "received",
            Self::Processing => "processing",
            Self::Approved => "approved",
            Self::Failed => "failed",
        }
    }
}

impl std::str::FromStr for WalletApprovalStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "received" => Ok(Self::Received),
            "processing" => Ok(Self::Processing),
            "approved" => Ok(Self::Approved),
            "failed" => Ok(Self::Failed),
            _ => Err(format!("Invalid wallet approval status: {}", s)),
        }
    }
}

impl std::fmt::Display for WalletApprovalStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Persisted wallet approval job and its audit snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WalletApproval {
    pub id: String,
    pub wallet_address: String,
    pub token_mint: String,
    pub asset_record_pda: String,
    pub compliance_record_pda: String,
    pub compliance_level: ComplianceLevel,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub range_risk_score: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub range_risk_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub range_reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub anchor_tx_signature: Option<String>,
    pub anchor_status: WalletApprovalStatus,
    pub retry_count: i32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub next_retry_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub approved_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Result returned by the blockchain port after building or reusing a wallet approval.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletApprovalSubmission {
    pub asset_record_pda: String,
    pub compliance_record_pda: String,
    pub tx_signature: Option<String>,
}

/// Core transfer request entity
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct TransferRequest {
    /// Unique identifier (UUID)
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
    /// Sender wallet address (Base58 Solana address)
    #[schema(example = "HvwC9QSAzwEXkUkwqNNGhfNHoVqXJYfPvPZfQvJmHWcF")]
    pub from_address: String,
    /// Recipient wallet address (Base58 Solana address)
    #[schema(example = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy")]
    pub to_address: String,

    /// Optional owner of the source token account when transfers are delegated.
    /// This lets Fortis move seller-held tokens after verifying the buyer intent signature.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source_owner_address: Option<String>,

    /// Transfer details
    pub transfer_details: TransferType,

    /// Token-2022 mint address for the Fortis RWA transfer.
    #[schema(example = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub token_mint: Option<String>,

    /// PDA for the RWA asset record.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub asset_record_pda: Option<String>,
    /// PDA for the sender compliance record when available.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sender_compliance_pda: Option<String>,
    /// PDA for the receiver compliance record when available.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub receiver_compliance_pda: Option<String>,
    /// Frozen Range Protocol score captured when the transfer was approved.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub range_risk_score: Option<i32>,
    /// Frozen Range Protocol level captured when the transfer was approved.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub range_risk_level: Option<String>,
    /// Frozen Range Protocol reasoning captured when the transfer was approved.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub range_reasoning: Option<String>,

    /// Compliance check status
    pub compliance_status: ComplianceStatus,
    /// Blockchain submission status
    pub blockchain_status: BlockchainStatus,
    /// Blockchain transaction signature (if submitted)
    #[schema(example = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")]
    pub blockchain_signature: Option<String>,
    /// Number of retry attempts for blockchain submission
    pub blockchain_retry_count: i32,
    /// Last error message from blockchain submission
    pub blockchain_last_error: Option<String>,
    /// Next scheduled retry time
    pub blockchain_next_retry_at: Option<DateTime<Utc>>,

    // =========================================================================
    // Jito Double Spend Protection Fields
    // =========================================================================
    /// Original transaction signature stored on first submission.
    /// Used to check status before retry when last_error_type is JitoStateUnknown.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub original_tx_signature: Option<String>,

    /// Classification of the last error encountered during blockchain submission.
    /// Determines retry strategy: JitoStateUnknown requires status check before retry.
    #[serde(default)]
    pub last_error_type: LastErrorType,

    /// Blockhash used in the last transaction attempt.
    /// Used to determine if blockhash has expired (>150 slots = safe to retry with new blockhash).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub blockhash_used: Option<String>,

    // =========================================================================
    // Request Uniqueness Fields (Replay Protection & Idempotency)
    // =========================================================================
    /// Unique nonce for replay protection. Included in the signed message
    /// to prevent replay attacks. Also used as idempotency key for deduplication.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[schema(example = "019470a4-7e7c-7d3e-8f1a-2b3c4d5e6f7a")]
    pub nonce: Option<String>,

    /// Original client signature stored for verification and auditing.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub client_signature: Option<String>,

    /// Creation timestamp
    pub created_at: DateTime<Utc>,
    /// Last update timestamp
    pub updated_at: DateTime<Utc>,
}

impl TransferRequest {
    #[must_use]
    pub fn new(id: String, from_address: String, to_address: String, amount: u64) -> Self {
        let now = Utc::now();
        Self {
            id,
            from_address,
            to_address,
            source_owner_address: None,
            transfer_details: TransferType::Public { amount },
            token_mint: None,
            asset_record_pda: None,
            sender_compliance_pda: None,
            receiver_compliance_pda: None,
            range_risk_score: None,
            range_risk_level: None,
            range_reasoning: None,
            compliance_status: ComplianceStatus::Pending,
            blockchain_status: BlockchainStatus::Received,
            blockchain_signature: None,
            blockchain_retry_count: 0,
            blockchain_last_error: None,
            blockchain_next_retry_at: None,
            // Jito Double Spend Protection fields
            original_tx_signature: None,
            last_error_type: LastErrorType::None,
            blockhash_used: None,
            // Request Uniqueness fields
            nonce: None,
            client_signature: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// Create a new transfer request with nonce for replay protection
    #[must_use]
    pub fn with_nonce(
        id: String,
        from_address: String,
        to_address: String,
        amount: u64,
        nonce: String,
        client_signature: String,
    ) -> Self {
        let mut request = Self::new(id, from_address, to_address, amount);
        request.nonce = Some(nonce);
        request.client_signature = Some(client_signature);
        request
    }

    /// Create a new token transfer request
    #[must_use]
    pub fn new_token(
        id: String,
        from_address: String,
        to_address: String,
        amount: u64,
        token_mint: String,
    ) -> Self {
        let mut request = Self::new(id, from_address, to_address, amount);
        request.token_mint = Some(token_mint);
        request
    }

    /// Check if this is an SPL Token transfer
    #[must_use]
    pub fn is_token_transfer(&self) -> bool {
        self.token_mint.is_some()
    }

    pub fn required_token_mint(&self) -> Result<&str, AppError> {
        self.token_mint.as_deref().ok_or_else(|| {
            AppError::Validation(crate::domain::ValidationError::InvalidField {
                field: "token_mint".to_string(),
                message: "token_mint is required for Fortis RWA relays".to_string(),
            })
        })
    }
}

impl Default for TransferRequest {
    fn default() -> Self {
        Self::new(
            "default_id".to_string(),
            "default_from".to_string(),
            "default_to".to_string(),
            0,
        )
    }
}

/// Request to submit a new transfer
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SubmitTransferRequest {
    /// Sender wallet address (Base58 Solana address)
    #[schema(example = "HvwC9QSAzwEXkUkwqNNGhfNHoVqXJYfPvPZfQvJmHWcF")]
    pub from_address: String,
    /// Recipient wallet address (Base58 Solana address)
    #[schema(example = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy")]
    pub to_address: String,

    /// Optional owner of the source token account when Fortis acts as a permanent delegate.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source_owner_address: Option<String>,

    /// Transfer details
    pub transfer_details: TransferType,

    /// Token-2022 mint address for the Fortis RWA relay.
    #[schema(example = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub token_mint: Option<String>,

    /// Base58-encoded Ed25519 signature proving ownership of from_address.
    /// The message format is: "{from_address}:{to_address}:{amount}:{token_mint}:{nonce}"
    #[schema(
        example = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
    )]
    pub signature: String,

    /// Unique nonce for replay protection (UUID v7 recommended).
    /// Must be included in the signature message to prevent replay attacks.
    /// Format: "{from}:{to}:{amount}:{mint}:{nonce}"
    #[schema(example = "019470a4-7e7c-7d3e-8f1a-2b3c4d5e6f7a")]
    pub nonce: String,
}

impl Validate for SubmitTransferRequest {
    fn validate(&self) -> Result<(), validator::ValidationErrors> {
        let mut errors = validator::ValidationErrors::new();

        if self.from_address.is_empty() {
            errors.add(
                "from_address",
                validator::ValidationError::new("From address is required"),
            );
        }
        if self.to_address.is_empty() {
            errors.add(
                "to_address",
                validator::ValidationError::new("To address is required"),
            );
        }
        if self.token_mint.as_deref().unwrap_or_default().is_empty() {
            errors.add(
                "token_mint",
                validator::ValidationError::new(
                    "Token mint is required for Fortis RWA transfer requests",
                ),
            );
        }

        // Nonce validation for replay protection
        if self.nonce.is_empty() {
            errors.add(
                "nonce",
                validator::ValidationError::new("Nonce is required for replay protection"),
            );
        } else if self.nonce.len() < 32 || self.nonce.len() > 64 {
            errors.add(
                "nonce",
                validator::ValidationError::new("Nonce must be 32-64 characters (UUID format)"),
            );
        } else if !self
            .nonce
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            errors.add(
                "nonce",
                validator::ValidationError::new(
                    "Nonce must be alphanumeric with optional hyphens (UUID format)",
                ),
            );
        }

        let TransferType::Public { amount } = &self.transfer_details;
        if *amount == 0 {
            errors.add(
                "amount",
                validator::ValidationError::new("Amount must be greater than 0"),
            );
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

impl SubmitTransferRequest {
    /// Verify that the signature is valid for this request.
    /// Returns Ok(()) if valid, or AppError::Authorization if invalid.
    pub fn verify_signature(&self) -> Result<(), AppError> {
        // Construct the deterministic message to verify
        let message = self.create_signing_message();

        // Decode the from_address as a Solana public key (32 bytes)
        let pubkey_bytes = bs58::decode(&self.from_address).into_vec().map_err(|e| {
            AppError::Authorization(format!("Invalid from_address encoding: {}", e))
        })?;

        if pubkey_bytes.len() != 32 {
            return Err(AppError::Authorization(format!(
                "Invalid from_address length: expected 32 bytes, got {}",
                pubkey_bytes.len()
            )));
        }

        let pubkey_array: [u8; 32] = pubkey_bytes
            .try_into()
            .map_err(|_| AppError::Authorization("Invalid from_address format".to_string()))?;

        let verifying_key = VerifyingKey::from_bytes(&pubkey_array)
            .map_err(|e| AppError::Authorization(format!("Invalid public key: {}", e)))?;

        // Decode the signature (64 bytes)
        let sig_bytes = bs58::decode(&self.signature)
            .into_vec()
            .map_err(|e| AppError::Authorization(format!("Invalid signature encoding: {}", e)))?;

        if sig_bytes.len() != 64 {
            return Err(AppError::Authorization(format!(
                "Invalid signature length: expected 64 bytes, got {}",
                sig_bytes.len()
            )));
        }

        let sig_array: [u8; 64] = sig_bytes
            .try_into()
            .map_err(|_| AppError::Authorization("Invalid signature format".to_string()))?;

        let signature = Signature::from_bytes(&sig_array);

        // Verify the signature
        verifying_key
            .verify_strict(&message, &signature)
            .map_err(|e| {
                AppError::Authorization(format!("Signature verification failed: {}", e))
            })?;

        Ok(())
    }

    /// Create the deterministic message for signing.
    /// Format: "{from_address}:{to_address}:{amount}:{token_mint}:{nonce}"
    ///
    /// The nonce MUST be included in the message to prevent replay attacks.
    /// Same parameters without a unique nonce would produce the same message,
    /// allowing an attacker to replay the signed request indefinitely.
    #[must_use]
    pub fn create_signing_message(&self) -> Vec<u8> {
        let TransferType::Public { amount } = &self.transfer_details;
        let mint_part = self.token_mint.as_deref().unwrap_or_default();
        format!(
            "{}:{}:{}:{}:{}",
            self.from_address, self.to_address, amount, mint_part, self.nonce
        )
        .into_bytes()
    }

    #[must_use]
    pub fn new(
        from_address: String,
        to_address: String,
        amount: u64,
        token_mint: String,
        signature: String,
        nonce: String,
    ) -> Self {
        Self {
            from_address,
            to_address,
            source_owner_address: None,
            transfer_details: TransferType::Public { amount },
            token_mint: Some(token_mint),
            signature,
            nonce,
        }
    }

    /// Create a new SPL Token transfer request
    #[must_use]
    pub fn new_token_transfer(
        from_address: String,
        to_address: String,
        amount: u64,
        token_mint: String,
        signature: String,
        nonce: String,
    ) -> Self {
        Self {
            from_address,
            to_address,
            source_owner_address: None,
            transfer_details: TransferType::Public { amount },
            token_mint: Some(token_mint),
            signature,
            nonce,
        }
    }

    /// Check if this is an SPL Token transfer
    #[must_use]
    pub fn is_token_transfer(&self) -> bool {
        self.token_mint.is_some()
    }

    pub fn required_token_mint(&self) -> Result<&str, AppError> {
        self.token_mint.as_deref().ok_or_else(|| {
            AppError::Validation(crate::domain::ValidationError::InvalidField {
                field: "token_mint".to_string(),
                message: "token_mint is required for Fortis RWA relays".to_string(),
            })
        })
    }
}

/// Request to mint and register a newly listed RWA asset.
#[derive(Debug, Clone, Serialize, Deserialize, Validate, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TokenizeListingRequest {
    #[validate(range(min = 1, message = "listingId must be greater than 0"))]
    #[schema(example = 42)]
    pub listing_id: i64,

    #[validate(length(min = 1, max = 64, message = "title is required"))]
    #[schema(example = "Apartment 12B, Almaty")]
    pub title: String,

    #[serde(default)]
    pub asset_type: AssetType,

    #[serde(default = "default_planned_supply")]
    #[validate(range(min = 1, message = "planned_supply must be greater than 0"))]
    #[schema(example = 1)]
    pub planned_supply: u64,

    #[serde(rename = "priceFiat")]
    #[validate(range(min = 1, message = "priceFiat must be greater than 0"))]
    #[schema(example = 150000)]
    pub valuation_usd: u64,

    #[validate(length(
        min = 32,
        max = 44,
        message = "sellerWalletAddress must be a Solana public key"
    ))]
    #[schema(example = "HvwC9QSAzwEXkUkwqNNGhfNHoVqXJYfPvPZfQvJmHWcF")]
    pub seller_wallet_address: String,

    #[serde(default)]
    #[schema(example = "Almaty")]
    pub city: Option<String>,

    #[serde(default)]
    #[schema(example = "Penthouse with park view and verified deed package.")]
    pub description: Option<String>,

    #[serde(default)]
    #[schema(example = "https://cdn.example.com/listing-42/front.jpg")]
    pub image_url: Option<String>,
}

impl TokenizeListingRequest {
    pub fn document_hash_bytes(&self) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        let payload = format!(
            "{}:{}:{}:{}:{}:{}",
            self.listing_id,
            self.title,
            self.valuation_usd,
            self.city.as_deref().unwrap_or_default(),
            self.description.as_deref().unwrap_or_default(),
            self.image_url.as_deref().unwrap_or_default()
        );
        let digest = sha2::Sha256::digest(payload.as_bytes());
        bytes.copy_from_slice(&digest);
        bytes
    }

    #[must_use]
    pub fn asset_name(&self) -> String {
        self.title.chars().take(64).collect()
    }

    #[must_use]
    pub fn document_uri(&self) -> String {
        let mut uri = format!("fortis://listing/{}", self.listing_id);
        if let Some(city) = self
            .city
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            uri.push_str(&format!("?city={}", city.replace(' ', "-")));
        }
        uri.chars().take(200).collect()
    }
}

/// Result returned after a listing has been tokenized and seller approvals are in place.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TokenizeListingResult {
    #[schema(example = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")]
    pub token_mint_address: String,
    #[schema(example = "4R7r6XoNFCg7c8JX3WmD4N8m5YJ6KZsQ1a5fH2LQv3kp")]
    pub asset_record_pda: String,
    #[schema(example = "7qSJw75oedM1gj3i2YxA6YnVxUa4u2AUsR4P7G6ykzNL")]
    pub seller_compliance_record_pda: String,
    #[schema(example = "9gP5v1o6mG5LZ6xU1w2sN1p2uQ4rT6yB8cM3nV7fK4Hy")]
    pub delegate_wallet_address: String,
    #[schema(example = 1)]
    pub planned_supply: u64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub initialize_mint_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub initialize_asset_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mint_to_signature: Option<String>,
}

/// Pagination parameters for list requests
#[derive(Debug, Clone, Serialize, Deserialize, Validate, ToSchema)]
pub struct PaginationParams {
    /// Maximum number of items to return (1-100, default: 20)
    #[validate(range(min = 1, max = 100, message = "Limit must be between 1 and 100"))]
    #[serde(default = "default_limit")]
    #[schema(example = 20)]
    pub limit: i64,
    /// Cursor for pagination (ID to start after)
    #[schema(example = "uuid-string")]
    pub cursor: Option<String>,
}

fn default_limit() -> i64 {
    20
}

fn default_planned_supply() -> u64 {
    1
}

impl Default for PaginationParams {
    fn default() -> Self {
        Self {
            limit: default_limit(),
            cursor: None,
        }
    }
}

/// Paginated response wrapper
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PaginatedResponse<T: ToSchema> {
    /// List of items
    pub items: Vec<T>,
    /// Cursor for next page (null if no more items)
    #[schema(example = "uuid-string")]
    pub next_cursor: Option<String>,
    /// Whether more items exist
    pub has_more: bool,
}

impl<T: ToSchema> PaginatedResponse<T> {
    pub fn new(items: Vec<T>, next_cursor: Option<String>, has_more: bool) -> Self {
        Self {
            items,
            next_cursor,
            has_more,
        }
    }

    pub fn empty() -> Self {
        Self {
            items: Vec::new(),
            next_cursor: None,
            has_more: false,
        }
    }
}

/// Health status enum
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    /// All systems operational
    Healthy,
    /// Some systems degraded but functional
    Degraded,
    /// Critical systems unavailable
    Unhealthy,
}

/// Health check response
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct HealthResponse {
    /// Overall system status
    pub status: HealthStatus,
    /// Database health status
    pub database: HealthStatus,
    /// Blockchain client health status
    pub blockchain: HealthStatus,
    /// Current server timestamp
    pub timestamp: DateTime<Utc>,
    /// Application version
    #[schema(example = "0.3.0")]
    pub version: String,
}

impl HealthResponse {
    #[must_use]
    pub fn new(database: HealthStatus, blockchain: HealthStatus) -> Self {
        let status = match (&database, &blockchain) {
            (HealthStatus::Healthy, HealthStatus::Healthy) => HealthStatus::Healthy,
            (HealthStatus::Unhealthy, _) | (_, HealthStatus::Unhealthy) => HealthStatus::Unhealthy,
            _ => HealthStatus::Degraded,
        };
        Self {
            status,
            database,
            blockchain,
            timestamp: Utc::now(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

/// Error response structure
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ErrorResponse {
    /// Error details
    pub error: ErrorDetail,
}

/// Error detail structure
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ErrorDetail {
    /// Error type identifier
    #[schema(example = "validation_error")]
    pub r#type: String,
    /// Human-readable error message
    #[schema(example = "Name must be between 1 and 255 characters")]
    pub message: String,
}

/// Rate limit exceeded response
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RateLimitResponse {
    /// Error details
    pub error: ErrorDetail,
    /// Seconds until rate limit resets
    #[schema(example = 60)]
    pub retry_after: u64,
}

// ============================================================================
// Risk Check Types (Pre-flight Compliance Screening)
// ============================================================================

/// Request to check wallet risk status
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RiskCheckRequest {
    /// Wallet address to check (Base58 Solana address)
    #[schema(example = "HvwC9QSAzwEXkUkwqNNGhfNHoVqXJYfPvPZfQvJmHWcF")]
    pub address: String,
}

/// Cached wallet risk profile from database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletRiskProfile {
    pub address: String,
    pub risk_score: Option<i32>,
    pub risk_level: Option<String>,
    pub reasoning: Option<String>,
    pub has_sanctioned_assets: bool,
    pub helius_assets_checked: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Result of a wallet risk check (polymorphic response)
///
/// This enum differentiates between:
/// - **Blocked**: Wallet found in internal blocklist (no external API calls made)
/// - **Analyzed**: Wallet checked against Range Protocol and Helius DAS
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RiskCheckResult {
    /// Wallet is blocked by internal blocklist.
    /// No risk score is returned as we skip external checks to save resources.
    Blocked {
        /// The wallet address that was checked
        #[schema(example = "4oS78GPe66RqBduuAeiMFANf27FpmgXNwokZ3ocN4z1B")]
        address: String,
        /// Reason for blocking from the internal blocklist
        #[schema(example = "Internal Security Alert: Address linked to Phishing Scam")]
        reason: String,
    },
    /// Wallet was analyzed (clean or warning level).
    /// Contains aggregated data from Range Protocol and Helius DAS.
    Analyzed {
        /// The wallet address that was checked
        #[schema(example = "HvwC9QSAzwEXkUkwqNNGhfNHoVqXJYfPvPZfQvJmHWcF")]
        address: String,
        /// Risk score from Range Protocol (1-10, higher = more risky)
        #[schema(example = 2)]
        risk_score: i32,
        /// Risk level description from Range Protocol
        #[schema(example = "Low risk")]
        risk_level: String,
        /// Reasoning from Range Protocol
        #[schema(example = "3 hops from nearest flagged address")]
        reasoning: String,
        /// Whether the wallet holds sanctioned NFTs/assets (from Helius DAS)
        #[schema(example = false)]
        has_sanctioned_assets: bool,
        /// Whether Helius DAS check was actually performed.
        /// If false, `has_sanctioned_assets` is a default value (check skipped).
        #[schema(example = true)]
        helius_assets_checked: bool,
        /// Whether this result came from cache
        #[schema(example = false)]
        from_cache: bool,
        /// Timestamp when the risk check was performed
        checked_at: DateTime<Utc>,
    },
}

/// Single transaction from Helius webhook (Enhanced Transaction format)
/// Reference: <https://docs.helius.dev/webhooks-and-websockets/webhooks>
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeliusTransaction {
    /// Transaction type (e.g., "TRANSFER", "NFT_SALE", "UNKNOWN")
    #[serde(rename = "type")]
    pub transaction_type: String,
    /// Transaction signature (base58)
    pub signature: String,
    /// Transaction error (null if successful, object/string if failed)
    #[serde(default)]
    pub transaction_error: Option<serde_json::Value>,
    /// Source program (e.g., "SYSTEM_PROGRAM")
    #[serde(default)]
    pub source: String,
}

// ============================================================================
// QuickNode Webhook Types
// ============================================================================

/// QuickNode webhook payload wrapper
/// Reference: <https://www.quicknode.com/docs/webhooks>
///
/// QuickNode webhooks can deliver multiple events in a single POST payload.
/// The payload is an array of events, NOT a single event object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum QuickNodeWebhookPayload {
    /// Array of events (most common)
    Events(Vec<QuickNodeWebhookEvent>),
    /// Single event (for backwards compatibility)
    Single(QuickNodeWebhookEvent),
}

impl QuickNodeWebhookPayload {
    /// Convert to a vector of events for uniform processing
    pub fn into_events(self) -> Vec<QuickNodeWebhookEvent> {
        match self {
            QuickNodeWebhookPayload::Events(events) => events,
            QuickNodeWebhookPayload::Single(event) => vec![event],
        }
    }
}

/// Single event from QuickNode Streams/Webhooks
///
/// QuickNode Streams can be configured with various filters and templates.
/// For transaction confirmation, we use the "Solana Transaction" template
/// which provides transaction metadata including signature and status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNodeWebhookEvent {
    /// Transaction signature (base58)
    pub signature: String,

    /// Slot number where the transaction was processed
    #[serde(default)]
    pub slot: Option<u64>,

    /// Block time (Unix timestamp) when the transaction was processed
    #[serde(default)]
    pub block_time: Option<i64>,

    /// Transaction error (null if successful)
    /// Can be a string error message or structured error object
    #[serde(default)]
    pub err: Option<serde_json::Value>,

    /// Transaction metadata (varies based on Stream template)
    #[serde(default)]
    pub meta: Option<QuickNodeTransactionMeta>,
}

impl QuickNodeWebhookEvent {
    /// Check if the transaction was successful
    pub fn is_success(&self) -> bool {
        self.err.is_none() && self.meta.as_ref().is_none_or(|m| m.err.is_none())
    }

    /// Get the error message if the transaction failed
    pub fn error_message(&self) -> Option<String> {
        if let Some(err) = &self.err {
            return Some(err.to_string());
        }
        if let Some(meta) = &self.meta
            && let Some(err) = &meta.err
        {
            return Some(err.to_string());
        }
        None
    }
}

/// Transaction metadata from QuickNode webhook
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNodeTransactionMeta {
    /// Transaction error from meta (null if successful)
    #[serde(default)]
    pub err: Option<serde_json::Value>,

    /// Fee in lamports
    #[serde(default)]
    pub fee: Option<u64>,

    /// Pre-transaction balances
    #[serde(default)]
    pub pre_balances: Vec<u64>,

    /// Post-transaction balances
    #[serde(default)]
    pub post_balances: Vec<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_blockchain_status_display_and_parsing() {
        let statuses = vec![
            (BlockchainStatus::Pending, "pending"),
            (BlockchainStatus::PendingSubmission, "pending_submission"),
            (BlockchainStatus::Submitted, "submitted"),
            (BlockchainStatus::Confirmed, "confirmed"),
            (BlockchainStatus::Failed, "failed"),
        ];

        for (status, string) in statuses {
            assert_eq!(status.as_str(), string);
            assert_eq!(status.to_string(), string);
            assert_eq!(BlockchainStatus::from_str(string).unwrap(), status);
        }

        assert!(BlockchainStatus::from_str("invalid").is_err());
    }

    #[test]
    fn test_compliance_status_display_and_parsing() {
        let statuses = vec![
            (ComplianceStatus::Pending, "pending"),
            (ComplianceStatus::Approved, "approved"),
            (ComplianceStatus::Rejected, "rejected"),
        ];

        for (status, string) in statuses {
            assert_eq!(status.as_str(), string);
            assert_eq!(status.to_string(), string);
            assert_eq!(ComplianceStatus::from_str(string).unwrap(), status);
        }

        assert!(ComplianceStatus::from_str("invalid").is_err());
    }

    #[test]
    fn test_submit_transfer_request_validation() {
        let valid_nonce = "019470a4-7e7c-7d3e-8f1a-2b3c4d5e6f7a".to_string();

        // Valid request (single whole-asset token)
        let req = SubmitTransferRequest::new(
            "From".to_string(),
            "To".to_string(),
            1,
            "Mint".to_string(),
            "sig".to_string(),
            valid_nonce.clone(),
        );
        assert!(req.validate().is_ok());

        // Invalid From (empty)
        let req = SubmitTransferRequest::new(
            "".to_string(),
            "To".to_string(),
            1,
            "Mint".to_string(),
            "sig".to_string(),
            valid_nonce.clone(),
        );
        assert!(req.validate().is_err());

        // Invalid To (empty)
        let req = SubmitTransferRequest::new(
            "From".to_string(),
            "".to_string(),
            1,
            "Mint".to_string(),
            "sig".to_string(),
            valid_nonce.clone(),
        );
        assert!(req.validate().is_err());

        // Invalid Amount (zero)
        let req = SubmitTransferRequest::new(
            "From".to_string(),
            "To".to_string(),
            0,
            "Mint".to_string(),
            "sig".to_string(),
            valid_nonce.clone(),
        );
        assert!(req.validate().is_err());

        // Invalid Nonce (empty)
        let req = SubmitTransferRequest::new(
            "From".to_string(),
            "To".to_string(),
            1,
            "Mint".to_string(),
            "sig".to_string(),
            "".to_string(),
        );
        assert!(req.validate().is_err());

        // Invalid Nonce (too short)
        let req = SubmitTransferRequest::new(
            "From".to_string(),
            "To".to_string(),
            1,
            "Mint".to_string(),
            "sig".to_string(),
            "short".to_string(),
        );
        assert!(req.validate().is_err());

        // Invalid Nonce (invalid characters)
        let req = SubmitTransferRequest::new(
            "From".to_string(),
            "To".to_string(),
            1,
            "Mint".to_string(),
            "sig".to_string(),
            "019470a4-7e7c-7d3e-8f1a-2b3c4d5e6f7!".to_string(),
        );
        assert!(req.validate().is_err());

        // Invalid request when Fortis token mint is missing
        let req = SubmitTransferRequest {
            from_address: "From".to_string(),
            to_address: "To".to_string(),
            source_owner_address: None,
            transfer_details: TransferType::Public { amount: 1 },
            token_mint: None,
            signature: "sig".to_string(),
            nonce: valid_nonce.clone(),
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn test_transfer_request_initialization_defaults() {
        let req = TransferRequest::new(
            "id_123".to_string(),
            "from_123".to_string(),
            "to_123".to_string(),
            1,
        );

        assert_eq!(req.compliance_status, ComplianceStatus::Pending);
        assert_eq!(req.blockchain_status, BlockchainStatus::Received);
        assert!(req.blockchain_signature.is_none());
        assert_eq!(req.blockchain_retry_count, 0);
        assert!(req.blockchain_last_error.is_none());
        assert!(req.blockchain_next_retry_at.is_none());
        assert!(req.source_owner_address.is_none());
        assert_eq!(req.transfer_details, TransferType::Public { amount: 1 });
    }

    #[test]
    fn test_transfer_request_serialization_roundtrip() {
        let req = TransferRequest::new(
            "tr_123".to_string(),
            "from_abc".to_string(),
            "to_xyz".to_string(),
            1,
        );

        let json = serde_json::to_string(&req).unwrap();
        let deserialized: TransferRequest = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.id, "tr_123");
        assert_eq!(deserialized.from_address, "from_abc");
        assert_eq!(deserialized.to_address, "to_xyz");
        assert_eq!(deserialized.source_owner_address, None);
        assert_eq!(
            deserialized.transfer_details,
            TransferType::Public { amount: 1 }
        );
    }

    // ========================================================================
    // QuickNode Webhook Types Tests
    // ========================================================================

    #[test]
    fn test_quicknode_webhook_payload_batch_parsing() {
        // QuickNode webhooks can deliver an array of events (most common case)
        let json = r#"[
            {"signature": "sig1", "slot": 12345, "err": null},
            {"signature": "sig2", "slot": 12346, "err": null},
            {"signature": "sig3", "slot": 12347, "err": {"InstructionError": [0, "Custom error"]}}
        ]"#;

        let payload: QuickNodeWebhookPayload = serde_json::from_str(json).unwrap();
        let events = payload.into_events();

        assert_eq!(events.len(), 3);
        assert_eq!(events[0].signature, "sig1");
        assert_eq!(events[1].signature, "sig2");
        assert_eq!(events[2].signature, "sig3");
    }

    #[test]
    fn test_quicknode_webhook_payload_single_parsing() {
        // Single event (less common but supported)
        let json = r#"{"signature": "single_sig", "slot": 99999}"#;

        let payload: QuickNodeWebhookPayload = serde_json::from_str(json).unwrap();
        let events = payload.into_events();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].signature, "single_sig");
        assert_eq!(events[0].slot, Some(99999));
    }

    #[test]
    fn test_quicknode_webhook_event_success_detection() {
        // Successful transaction (no error)
        let event = QuickNodeWebhookEvent {
            signature: "success_sig".to_string(),
            slot: Some(12345),
            block_time: Some(1700000000),
            err: None,
            meta: None,
        };
        assert!(event.is_success());
        assert!(event.error_message().is_none());

        // Failed transaction (err field set)
        let event = QuickNodeWebhookEvent {
            signature: "failed_sig".to_string(),
            slot: Some(12345),
            block_time: Some(1700000000),
            err: Some(serde_json::json!({"InstructionError": [0, "Custom error"]})),
            meta: None,
        };
        assert!(!event.is_success());
        assert!(event.error_message().is_some());
    }

    #[test]
    fn test_quicknode_webhook_event_meta_error() {
        // Failed transaction (error in meta.err)
        let meta = QuickNodeTransactionMeta {
            err: Some(serde_json::json!("InsufficientFunds")),
            fee: Some(5000),
            pre_balances: vec![1000000, 0],
            post_balances: vec![995000, 0],
        };

        let event = QuickNodeWebhookEvent {
            signature: "meta_error_sig".to_string(),
            slot: Some(12345),
            block_time: None,
            err: None,
            meta: Some(meta),
        };
        assert!(!event.is_success());
        assert!(event.error_message().is_some());
    }
}
