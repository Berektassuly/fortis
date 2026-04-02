//! Domain layer containing core business types, traits, and error definitions.

pub mod error;
pub mod traits;
pub mod types;

pub use error::{
    AppError, BlockchainError, ConfigError, DatabaseError, ExternalServiceError, ValidationError,
};
pub use traits::{BlockchainClient, ComplianceProvider, DatabaseClient};
pub use types::{
    AssetType, BlockchainStatus, BlockchainSubmission, ComplianceDecision, ComplianceLevel,
    ComplianceStatus, ErrorDetail, ErrorResponse, HealthResponse, HealthStatus, HeliusTransaction,
    LastErrorType, PaginatedResponse, PaginationParams, QuickNodeTransactionMeta,
    QuickNodeWebhookEvent, QuickNodeWebhookPayload, RateLimitResponse, RiskCheckRequest,
    RiskCheckResult, SubmitTransferRequest, TokenizeListingRequest, TokenizeListingResult,
    TransactionStatus, TransferRequest, TransferType, WalletApproval, WalletApprovalStatus,
    WalletApprovalSubmission, WalletRiskProfile,
};
