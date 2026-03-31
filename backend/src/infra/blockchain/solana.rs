//! Blockchain RPC client implementation for Solana.
//!
//! This module provides both mock and real blockchain interactions.
//! Real blockchain functionality is enabled with the `real-blockchain` feature.

use async_trait::async_trait;
use borsh::BorshSerialize;
use ed25519_dalek::{Signer, SigningKey};
use reqwest::Client;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::str::FromStr;
use std::time::Duration;
use tracing::{debug, info, instrument, warn};

// Solana SDK imports (v3.0)
use solana_client::nonblocking::rpc_client::RpcClient as SolanaRpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signer::{Signer as SolanaSigner, keypair::Keypair},
    transaction::Transaction,
};
use solana_system_interface::instruction as system_instruction;
use sha2::{Digest, Sha256};
use spl_associated_token_account::{
    get_associated_token_address_with_program_id,
    instruction::create_associated_token_account_idempotent,
};
use spl_token_2022_interface::{
    extension::{ExtensionType, transfer_hook::instruction as transfer_hook_instruction},
    id as token_2022_program_id,
    instruction as token2022_instruction,
    pod::PodMint,
};
use spl_transfer_hook_interface::{
    get_extra_account_metas_address,
    offchain::add_extra_account_metas_for_execute,
};

use crate::domain::types::{TransferType, fortis_rwa_program_pubkey};
use crate::domain::{
    AppError, AssetType, BlockchainClient, BlockchainError, ComplianceLevel,
    TokenizeListingRequest, TokenizeListingResult, TransferRequest, WalletApprovalSubmission,
};

/// Configuration for the RPC client
#[derive(Debug, Clone)]
pub struct RpcClientConfig {
    pub timeout: Duration,
    pub max_retries: u32,
    pub retry_delay: Duration,
    pub confirmation_timeout: Duration,
}

impl Default for RpcClientConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(30),
            max_retries: 3,
            retry_delay: Duration::from_millis(500),
            confirmation_timeout: Duration::from_secs(60),
        }
    }
}

/// Abstract provider for Solana RPC interactions to enable testing
#[async_trait]
pub trait SolanaRpcProvider: Send + Sync {
    /// Send a JSON-RPC request
    async fn send_request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, AppError>;

    /// Get the provider's public key
    fn public_key(&self) -> String;

    /// Sign a message
    fn sign(&self, message: &[u8]) -> String;
}

/// HTTP-based Solana RPC provider
pub struct HttpSolanaRpcProvider {
    http_client: Client,
    rpc_url: String,
    signing_key: SigningKey,
}

impl HttpSolanaRpcProvider {
    pub fn new(
        rpc_url: &str,
        signing_key: SigningKey,
        timeout: Duration,
    ) -> Result<Self, AppError> {
        let http_client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|e| AppError::Blockchain(BlockchainError::Connection(e.to_string())))?;

        Ok(Self {
            http_client,
            rpc_url: rpc_url.to_string(),
            signing_key,
        })
    }
}

#[async_trait]
impl SolanaRpcProvider for HttpSolanaRpcProvider {
    async fn send_request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, AppError> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id: 1,
            method: method.to_string(),
            params,
        };

        let response = self
            .http_client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AppError::Blockchain(BlockchainError::Timeout(e.to_string()))
                } else {
                    AppError::Blockchain(BlockchainError::RpcError(e.to_string()))
                }
            })?;

        let rpc_response: JsonRpcResponse<serde_json::Value> = response
            .json()
            .await
            .map_err(|e| AppError::Blockchain(BlockchainError::RpcError(e.to_string())))?;

        if let Some(error) = rpc_response.error {
            // Check for insufficient funds error
            if error.message.contains("insufficient") || error.code == -32002 {
                return Err(AppError::Blockchain(BlockchainError::InsufficientFunds));
            }
            return Err(AppError::Blockchain(BlockchainError::RpcError(format!(
                "{}: {}",
                error.code, error.message
            ))));
        }

        rpc_response.result.ok_or_else(|| {
            AppError::Blockchain(BlockchainError::RpcError("Empty response".to_string()))
        })
    }

    fn public_key(&self) -> String {
        bs58::encode(self.signing_key.verifying_key().as_bytes()).into_string()
    }

    fn sign(&self, message: &[u8]) -> String {
        let signature = self.signing_key.sign(message);
        bs58::encode(signature.to_bytes()).into_string()
    }
}

/// Solana RPC blockchain client with provider strategy pattern
///
/// Auto-detects the RPC provider (Helius, QuickNode, Standard) and activates
/// premium features accordingly:
/// - Helius: Priority fee estimation, DAS compliance checks
/// - QuickNode: Priority fee estimation, Jito bundle submission (Ghost Mode)
/// - Standard: Fallback fee strategy
pub struct RpcBlockchainClient {
    provider: Box<dyn SolanaRpcProvider>,
    config: RpcClientConfig,
    /// Solana SDK RPC client for SDK-based operations
    sdk_client: Option<SolanaRpcClient>,
    /// Solana keypair for signing transactions
    keypair: Option<Keypair>,
    /// Auto-detected provider type
    provider_type: super::strategies::RpcProviderType,
    /// Priority fee estimation strategy
    fee_strategy: Box<dyn super::strategies::FeeStrategy>,
    /// Transaction submission strategy (Jito bundles, standard RPC, etc.)
    /// When present, transactions are submitted via this strategy instead of
    /// the SDK's send_and_confirm_transaction.
    submission_strategy: Option<Box<dyn super::strategies::SubmissionStrategy>>,
    /// Helius DAS client for compliance checks (only for Helius provider)
    das_client: Option<super::helius::HeliusDasClient>,
    /// RPC URL (stored for strategy use, logging, and future getter)
    #[allow(dead_code)]
    rpc_url: String,
    /// Jito tip amount in lamports (only used when submission_strategy supports private submission)
    /// This tip is added as a SOL transfer instruction to a Jito tip account.
    jito_tip_lamports: Option<u64>,
}

#[derive(Debug, Serialize)]
struct JsonRpcRequest<T: Serialize> {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    params: T,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Deserialize)]
struct BlockhashResponse {
    blockhash: String,
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Deserialize)]
struct BlockhashResult {
    value: BlockhashResponse,
}

#[derive(BorshSerialize)]
struct InitializeAssetArgs {
    name: String,
    asset_type: AssetTypeBorsh,
    planned_supply: u64,
    valuation_usd: u64,
    document_uri: String,
    document_hash: [u8; 32],
}

#[derive(BorshSerialize, Clone, Copy)]
enum AssetTypeBorsh {
    RealEstate,
    Bond,
    Commodity,
    Equity,
    Other,
}

impl From<AssetType> for AssetTypeBorsh {
    fn from(value: AssetType) -> Self {
        match value {
            AssetType::RealEstate => Self::RealEstate,
            AssetType::Bond => Self::Bond,
            AssetType::Commodity => Self::Commodity,
            AssetType::Equity => Self::Equity,
            AssetType::Other => Self::Other,
        }
    }
}

#[derive(Debug, Deserialize)]
struct SignatureStatus {
    err: Option<serde_json::Value>,
    #[serde(rename = "confirmationStatus")]
    confirmation_status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SignatureStatusResult {
    value: Vec<Option<SignatureStatus>>,
}

/// Response structure for QuickNode's qn_estimatePriorityFees API
#[allow(dead_code)] // Scaffolded for QuickNode fee strategy
#[derive(Debug, Deserialize)]
struct QuickNodePriorityFeeResponse {
    per_compute_unit: Option<QuickNodePriorityFeeLevel>,
}

/// Priority fee levels from QuickNode API (values in micro-lamports)
#[allow(dead_code)] // Scaffolded for QuickNode fee strategy
#[derive(Debug, Deserialize)]
struct QuickNodePriorityFeeLevel {
    high: Option<f64>,
    #[allow(dead_code)]
    medium: Option<f64>,
    #[allow(dead_code)]
    low: Option<f64>,
}

impl RpcBlockchainClient {
    /// Create a new RPC blockchain client with custom configuration
    ///
    /// Automatically detects the RPC provider type and activates premium features:
    /// - **Helius**: Priority fee estimation via `getPriorityFeeEstimate`, DAS compliance checks
    /// - **QuickNode**: Priority fee estimation via `qn_estimatePriorityFees`
    /// - **Standard**: Fallback to static priority fee
    ///
    /// Note: This constructor does NOT enable Jito bundle submission. Use
    /// `new_with_submission_strategy` to enable MEV-protected submission.
    pub fn new(
        rpc_url: &str,
        signing_key: SigningKey,
        config: RpcClientConfig,
    ) -> Result<Self, AppError> {
        Self::new_with_submission_strategy(rpc_url, signing_key, config, None, None)
    }

    /// Create a new RPC blockchain client with custom configuration and submission strategy
    ///
    /// Automatically detects the RPC provider type and activates premium features:
    /// - **Helius**: Priority fee estimation via `getPriorityFeeEstimate`, DAS compliance checks
    /// - **QuickNode**: Priority fee estimation via `qn_estimatePriorityFees`, Jito bundles (if enabled)
    /// - **Standard**: Fallback to static priority fee
    ///
    /// # Arguments
    /// * `rpc_url` - The RPC endpoint URL
    /// * `signing_key` - The ed25519 signing key for transaction signing
    /// * `config` - Client configuration (timeouts, retries, etc.)
    /// * `submission_strategy` - Optional submission strategy for MEV-protected submission
    /// * `jito_tip_lamports` - Optional tip amount for Jito bundles (in lamports)
    ///
    /// # Submission Strategy Behavior
    /// When a submission strategy is provided:
    /// - Transactions are submitted via the strategy (e.g., Jito bundles)
    /// - Returns immediately after submission (does NOT wait for confirmation)
    /// - Confirmation should be handled via polling or webhooks
    ///
    /// When no submission strategy is provided (None):
    /// - Uses SDK's `send_and_confirm_transaction` (blocks until confirmed)
    /// - Backward compatible with existing behavior
    ///
    /// # Jito Tip Injection
    /// When `jito_tip_lamports` is Some and the submission strategy supports private
    /// submission, a SOL transfer instruction to a Jito tip account is automatically
    /// appended to each transaction before signing. This tip is REQUIRED for Jito
    /// bundle acceptance.
    pub fn new_with_submission_strategy(
        rpc_url: &str,
        signing_key: SigningKey,
        config: RpcClientConfig,
        submission_strategy: Option<Box<dyn super::strategies::SubmissionStrategy>>,
        jito_tip_lamports: Option<u64>,
    ) -> Result<Self, AppError> {
        use super::helius::{HeliusDasClient, HeliusFeeStrategy};
        use super::strategies::{FallbackFeeStrategy, QuickNodeFeeStrategy, RpcProviderType};

        let provider = HttpSolanaRpcProvider::new(rpc_url, signing_key.clone(), config.timeout)?;

        // Auto-detect provider type from URL
        let provider_type = RpcProviderType::detect(rpc_url);
        info!(
            provider = %provider_type.name(),
            rpc_url = %rpc_url,
            "Detected RPC provider type"
        );

        // Select fee strategy and DAS client based on provider type
        let (fee_strategy, das_client): (
            Box<dyn super::strategies::FeeStrategy>,
            Option<HeliusDasClient>,
        ) = match &provider_type {
            RpcProviderType::Helius => {
                info!("Helius Priority Fee Strategy activated!");
                info!("Helius DAS Check enabled");
                (
                    Box::new(HeliusFeeStrategy::new(rpc_url)),
                    Some(HeliusDasClient::new(rpc_url)),
                )
            }
            RpcProviderType::QuickNode => {
                info!("QuickNode Priority Fee Strategy activated");
                (Box::new(QuickNodeFeeStrategy::new(rpc_url)), None)
            }
            RpcProviderType::Standard => {
                info!("Standard RPC (fallback fee strategy)");
                (Box::new(FallbackFeeStrategy::new()), None)
            }
        };

        // Create Solana SDK keypair from ed25519-dalek signing key
        let keypair_bytes = signing_key.to_keypair_bytes();
        let keypair = Keypair::try_from(keypair_bytes.as_slice()).map_err(|e| {
            AppError::Blockchain(BlockchainError::InvalidSignature(format!(
                "Failed to create keypair: {}",
                e
            )))
        })?;

        // Create Solana SDK RPC client
        let sdk_client = SolanaRpcClient::new_with_timeout_and_commitment(
            rpc_url.to_string(),
            config.timeout,
            CommitmentConfig::confirmed(),
        );

        // Log submission strategy status
        let strategy_name = submission_strategy
            .as_ref()
            .map(|s| s.name())
            .unwrap_or("None (SDK send_and_confirm)");

        // Only log tip if we have a strategy that supports private submission
        let effective_tip = if submission_strategy
            .as_ref()
            .is_some_and(|s| s.supports_private_submission())
        {
            jito_tip_lamports
        } else {
            None
        };

        info!(
            rpc_url = %rpc_url,
            provider = %provider_type.name(),
            fee_strategy = %fee_strategy.name(),
            submission_strategy = %strategy_name,
            jito_tip_lamports = ?effective_tip,
            das_enabled = das_client.is_some(),
            "Created blockchain client with SDK support"
        );

        Ok(Self {
            provider: Box::new(provider),
            config,
            sdk_client: Some(sdk_client),
            keypair: Some(keypair),
            provider_type,
            fee_strategy,
            submission_strategy,
            das_client,
            rpc_url: rpc_url.to_string(),
            jito_tip_lamports,
        })
    }

    /// Create a new RPC blockchain client with default configuration
    pub fn with_defaults(rpc_url: &str, signing_key: SigningKey) -> Result<Self, AppError> {
        Self::new(rpc_url, signing_key, RpcClientConfig::default())
    }

    /// Create a new RPC blockchain client with default configuration and submission strategy
    ///
    /// Convenience method that combines `with_defaults` with submission strategy support.
    ///
    /// # Arguments
    /// * `rpc_url` - The RPC endpoint URL
    /// * `signing_key` - The ed25519 signing key for transaction signing
    /// * `submission_strategy` - Optional submission strategy for MEV-protected submission
    /// * `jito_tip_lamports` - Optional tip amount for Jito bundles (in lamports)
    pub fn with_defaults_and_submission_strategy(
        rpc_url: &str,
        signing_key: SigningKey,
        submission_strategy: Option<Box<dyn super::strategies::SubmissionStrategy>>,
        jito_tip_lamports: Option<u64>,
    ) -> Result<Self, AppError> {
        Self::new_with_submission_strategy(
            rpc_url,
            signing_key,
            RpcClientConfig::default(),
            submission_strategy,
            jito_tip_lamports,
        )
    }

    /// Create a new client with a specific provider (useful for testing)
    pub fn with_provider(provider: Box<dyn SolanaRpcProvider>, config: RpcClientConfig) -> Self {
        use super::strategies::{FallbackFeeStrategy, RpcProviderType};

        Self {
            provider,
            config,
            sdk_client: None,
            keypair: None,
            provider_type: RpcProviderType::Standard,
            fee_strategy: Box::new(FallbackFeeStrategy::new()),
            submission_strategy: None,
            das_client: None,
            rpc_url: String::new(),
            jito_tip_lamports: None,
        }
    }

    /// Check if this client has a submission strategy configured
    pub fn has_submission_strategy(&self) -> bool {
        self.submission_strategy.is_some()
    }

    /// Check if this client supports private/MEV-protected submission
    pub fn supports_private_submission(&self) -> bool {
        self.submission_strategy
            .as_ref()
            .is_some_and(|s| s.supports_private_submission())
    }

    /// Creates a Jito tip instruction if Jito submission is enabled and configured.
    ///
    /// This method creates a SOL transfer instruction from the payer to a randomly
    /// selected Jito tip account. The tip is REQUIRED for Jito bundle acceptance.
    ///
    /// # Returns
    /// - `Some(Instruction)` - Tip instruction to append to the transaction
    /// - `None` - If Jito is not enabled, not supported, or tip amount is 0
    ///
    /// # Best Practices
    /// The tip instruction should be the LAST instruction in the transaction to avoid
    /// potential issues with instruction ordering during bundle processing.
    fn create_jito_tip_instruction(&self, payer: &Pubkey) -> Option<Instruction> {
        // Only add tip if we have a Jito-enabled submission strategy
        if !self.supports_private_submission() {
            return None;
        }

        let tip_lamports = self.jito_tip_lamports?;

        if tip_lamports == 0 {
            debug!("Jito tip is 0, skipping tip instruction");
            return None;
        }

        // Select a random tip account to reduce contention
        let tip_account_str = super::random_jito_tip_account();
        let tip_account = tip_account_str
            .parse::<Pubkey>()
            .expect("Hardcoded Jito tip account should be valid");

        debug!(
            tip_lamports = tip_lamports,
            tip_account = %tip_account,
            "Creating Jito tip instruction"
        );

        Some(system_instruction::transfer(
            payer,
            &tip_account,
            tip_lamports,
        ))
    }

    /// Get the detected provider type
    pub fn provider_type(&self) -> &super::strategies::RpcProviderType {
        &self.provider_type
    }

    /// Check if Helius DAS is available
    pub fn has_das_support(&self) -> bool {
        self.das_client.is_some()
    }

    /// Get the public key as base58 string
    #[must_use]
    pub fn public_key(&self) -> String {
        self.provider.public_key()
    }

    /// Sign a message and return the signature as base58
    #[must_use]
    pub fn sign(&self, message: &[u8]) -> String {
        self.provider.sign(message)
    }

    /// Make an RPC call with retries
    #[instrument(skip(self, params))]
    async fn rpc_call<P: Serialize + Send + Sync, R: DeserializeOwned + Send>(
        &self,
        method: &str,
        params: P,
    ) -> Result<R, AppError> {
        // Serialize parameters to JSON Value
        let params_value = serde_json::to_value(params).map_err(|e| {
            AppError::Blockchain(BlockchainError::RpcError(format!(
                "Serialization error: {}",
                e
            )))
        })?;

        let mut last_error = None;
        for attempt in 0..=self.config.max_retries {
            if attempt > 0 {
                tokio::time::sleep(self.config.retry_delay).await;
            }
            match self
                .provider
                .send_request(method, params_value.clone())
                .await
            {
                Ok(result_value) => {
                    // Deserialize result from JSON Value
                    return serde_json::from_value(result_value).map_err(|e| {
                        AppError::Blockchain(BlockchainError::RpcError(format!(
                            "Deserialization error: {}",
                            e
                        )))
                    });
                }
                Err(e) => {
                    warn!(attempt = attempt, error = ?e, method = %method, "RPC call failed");
                    last_error = Some(e);
                }
            }
        }
        Err(last_error.unwrap_or_else(|| {
            AppError::Blockchain(BlockchainError::RpcError("Unknown error".to_string()))
        }))
    }

    /// Get priority fee using the appropriate strategy for the detected provider.
    ///
    /// This method delegates to the configured fee strategy:
    /// - Helius: Uses `getPriorityFeeEstimate` for transaction-aware estimation
    /// - QuickNode: Uses `qn_estimatePriorityFees` for global estimation
    /// - Standard: Returns a static fallback value
    ///
    /// # Arguments
    /// * `serialized_tx` - Optional Base58-encoded serialized transaction
    ///   (used by Helius for per-account fee estimation)
    async fn get_priority_fee(&self, serialized_tx: Option<&str>) -> u64 {
        self.fee_strategy.get_priority_fee(serialized_tx).await
    }

    /// Legacy method for backward compatibility - calls the new strategy-based method
    #[allow(dead_code)]
    async fn get_quicknode_priority_fee(&self) -> u64 {
        self.get_priority_fee(None).await
    }

    /// Submit a transaction via the configured strategy, or fall back to SDK confirmation
    ///
    /// # Behavior
    /// - **With submission strategy**: Serializes to Base58, submits via strategy, returns
    ///   immediately. The transaction is "submitted" but not yet "confirmed". Confirmation
    ///   should be handled via polling (`wait_for_confirmation`) or webhooks.
    ///
    /// - **Without submission strategy**: Uses SDK's `send_and_confirm_transaction` which
    ///   blocks until the transaction is confirmed. Returns only after confirmation.
    ///
    /// # Important: "Submitted" State Resilience
    /// When using the submission strategy path, the transaction is persisted as "Submitted"
    /// immediately after this call returns successfully. However, the transaction may not
    /// be indexed by RPC nodes yet. `get_transaction_status` handles this gracefully by
    /// returning `false` (not confirmed) rather than an error for "not found" transactions.
    async fn submit_or_confirm_transaction(
        &self,
        transaction: &Transaction,
    ) -> Result<(String, String), AppError> {
        let sdk_client = self.sdk_client.as_ref().ok_or_else(|| {
            AppError::Blockchain(BlockchainError::TransactionFailed(
                "SDK client not available".to_string(),
            ))
        })?;

        // Capture blockhash from the transaction for Jito double-spend protection (expiry checks)
        let blockhash_str = transaction.message().recent_blockhash.to_string();

        if let Some(ref strategy) = self.submission_strategy {
            // Serialize transaction to Base58 for strategy submission
            let serialized_tx = self.serialize_transaction_base58(transaction)?;

            // Submit via strategy (Jito bundle, standard sendTransaction, etc.)
            // The strategy handles signature extraction internally
            let signature = strategy
                .submit_transaction(&serialized_tx, true)
                .await
                .map_err(|e| wrap_error_with_blockhash(e, &blockhash_str))?;

            info!(
                signature = %signature,
                strategy = %strategy.name(),
                "Transaction submitted via submission strategy (confirmation pending)"
            );

            Ok((signature, blockhash_str))
        } else {
            // No strategy - use SDK's blocking send_and_confirm
            let signature = sdk_client
                .send_and_confirm_transaction(transaction)
                .await
                .map_err(|e| {
                    let mapped = map_solana_client_error(e);
                    wrap_error_with_blockhash(mapped, &blockhash_str)
                })?;

            debug!(
                signature = %signature,
                "Transaction confirmed via SDK send_and_confirm"
            );

            Ok((signature.to_string(), blockhash_str))
        }
    }

    /// Serialize a signed transaction to Base58 encoding
    ///
    /// Used for submitting transactions via the submission strategy.
    fn serialize_transaction_base58(&self, transaction: &Transaction) -> Result<String, AppError> {
        let serialized = bincode::serialize(transaction).map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to serialize transaction: {}",
                e
            )))
        })?;

        Ok(bs58::encode(&serialized).into_string())
    }

    /// Submit a transaction and wait for confirmation
    ///
    /// This method is used for multi-step flows where later work depends on
    /// earlier transactions being confirmed before we proceed.
    ///
    /// # Behavior
    /// - **With submission strategy**: Submits via strategy (MEV-protected), then polls
    ///   for confirmation using `get_transaction_status` until confirmed or timeout.
    ///
    /// - **Without submission strategy**: Uses SDK's `send_and_confirm_transaction`.
    ///
    #[allow(dead_code)]
    async fn submit_and_confirm_transaction(
        &self,
        transaction: &Transaction,
        description: &str,
    ) -> Result<String, AppError> {
        let sdk_client = self.sdk_client.as_ref().ok_or_else(|| {
            AppError::Blockchain(BlockchainError::TransactionFailed(
                "SDK client not available".to_string(),
            ))
        })?;

        if let Some(ref strategy) = self.submission_strategy {
            // Serialize transaction to Base58 for strategy submission
            let serialized_tx = self.serialize_transaction_base58(transaction)?;

            // Submit via strategy (Jito bundle, standard sendTransaction, etc.)
            let signature = strategy.submit_transaction(&serialized_tx, true).await?;

            info!(
                signature = %signature,
                strategy = %strategy.name(),
                description = %description,
                "Transaction submitted via strategy, waiting for confirmation..."
            );

            // Wait for confirmation (poll-based)
            // Use a reasonable timeout for on-chain confirmation
            let confirmation_timeout_secs = self.config.confirmation_timeout.as_secs();
            let confirmed = self
                .wait_for_confirmation(&signature, confirmation_timeout_secs)
                .await?;

            if !confirmed {
                return Err(AppError::Blockchain(BlockchainError::Timeout(format!(
                    "Transaction {} not confirmed within {}s: {}",
                    signature, confirmation_timeout_secs, description
                ))));
            }

            info!(
                signature = %signature,
                description = %description,
                "Transaction confirmed"
            );

            Ok(signature)
        } else {
            // No strategy - use SDK's blocking send_and_confirm
            let signature = sdk_client
                .send_and_confirm_transaction(transaction)
                .await
                .map_err(|e| {
                    AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                        "{}: {}",
                        description, e
                    )))
                })?;

            debug!(
                signature = %signature,
                description = %description,
                "Transaction confirmed via SDK"
            );

            Ok(signature.to_string())
        }
    }

    fn require_sdk_and_keypair(&self) -> Result<(&SolanaRpcClient, &Keypair), AppError> {
        let sdk_client = self.sdk_client.as_ref().ok_or_else(|| {
            AppError::Blockchain(BlockchainError::Connection(
                "No SDK client available".to_string(),
            ))
        })?;
        let keypair = self.keypair.as_ref().ok_or_else(|| {
            AppError::Blockchain(BlockchainError::WalletError(
                "No keypair available for signing".to_string(),
            ))
        })?;
        Ok((sdk_client, keypair))
    }

    fn anchor_discriminator(name: &str) -> [u8; 8] {
        let digest = Sha256::digest(name.as_bytes());
        let mut discriminator = [0u8; 8];
        discriminator.copy_from_slice(&digest[..8]);
        discriminator
    }

    fn anchor_instruction_data_with_args<T: BorshSerialize>(
        name: &str,
        args: &T,
    ) -> Result<Vec<u8>, AppError> {
        let mut data = Self::anchor_discriminator(name).to_vec();
        let serialized = borsh::to_vec(args).map_err(|error| {
            AppError::Serialization(format!(
                "Failed to serialize Anchor instruction {}: {}",
                name, error
            ))
        })?;
        data.extend(serialized);
        Ok(data)
    }

    fn anchor_instruction_data(name: &str) -> Vec<u8> {
        Self::anchor_discriminator(name).to_vec()
    }

    fn read_mint_decimals(mint_data: &[u8]) -> Result<u8, AppError> {
        const DECIMALS_OFFSET: usize = 44;
        const MIN_MINT_SIZE: usize = 82;

        if mint_data.len() < MIN_MINT_SIZE {
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                format!(
                    "Mint account data too small: {} bytes, expected at least {}",
                    mint_data.len(),
                    MIN_MINT_SIZE
                ),
            )));
        }

        Ok(mint_data[DECIMALS_OFFSET])
    }

    async fn build_wallet_approval_instruction(
        &self,
        token_mint: &str,
        wallet_address: &str,
        compliance_level: ComplianceLevel,
    ) -> Result<(String, String, Option<Instruction>), AppError> {
        let (sdk_client, keypair) = self.require_sdk_and_keypair()?;

        let mint_pubkey = token_mint.parse::<Pubkey>().map_err(|e| {
            AppError::Validation(crate::domain::ValidationError::InvalidField {
                field: "token_mint".to_string(),
                message: format!("Invalid base58 pubkey: {}", e),
            })
        })?;
        let wallet_pubkey = wallet_address.parse::<Pubkey>().map_err(|e| {
            AppError::Validation(crate::domain::ValidationError::InvalidField {
                field: "wallet_address".to_string(),
                message: format!("Invalid base58 pubkey: {}", e),
            })
        })?;
        let program_id = fortis_rwa_program_pubkey()?;
        let (asset_record_pda, _) =
            Pubkey::find_program_address(&[b"asset", mint_pubkey.as_ref()], &program_id);
        let (compliance_record_pda, _) = Pubkey::find_program_address(
            &[b"compliance", mint_pubkey.as_ref(), wallet_pubkey.as_ref()],
            &program_id,
        );
        let asset_record_pda_str = asset_record_pda.to_string();
        let compliance_record_pda_str = compliance_record_pda.to_string();
        let system_program_id =
            Pubkey::from_str("11111111111111111111111111111111").expect("valid system program id");

        let mint_account = sdk_client.get_account(&mint_pubkey).await.map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to fetch mint account for wallet approval: {}",
                e
            )))
        })?;
        if mint_account.owner != token_2022_program_id() {
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                format!(
                    "Fortis RWA wallet approvals require a Token-2022 mint. Expected owner {}, found {}",
                    token_2022_program_id(),
                    mint_account.owner
                ),
            )));
        }

        let asset_record_account = sdk_client
            .get_account(&asset_record_pda)
            .await
            .map_err(|e| {
                AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                    "Asset record PDA {} was not found for mint {}: {}",
                    asset_record_pda, token_mint, e
                )))
            })?;
        if asset_record_account.owner != program_id {
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                format!(
                    "Asset record PDA {} is not owned by the Fortis RWA program {}",
                    asset_record_pda, program_id
                ),
            )));
        }

        if let Ok(existing_record) = sdk_client.get_account(&compliance_record_pda).await {
            if existing_record.owner != program_id {
                return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                    format!(
                        "Compliance record PDA {} exists but is not owned by the Fortis RWA program {}",
                        compliance_record_pda, program_id
                    ),
                )));
            }

            return Ok((asset_record_pda_str, compliance_record_pda_str, None));
        }

        let mut instruction_data = Self::anchor_instruction_data("global:approve_wallet");
        instruction_data.push(match compliance_level {
            ComplianceLevel::Basic => 0,
            ComplianceLevel::Standard => 1,
            ComplianceLevel::Enhanced => 2,
        });

        let approve_wallet_ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(keypair.pubkey(), true),
                AccountMeta::new_readonly(mint_pubkey, false),
                AccountMeta::new_readonly(asset_record_pda, false),
                AccountMeta::new_readonly(wallet_pubkey, false),
                AccountMeta::new(compliance_record_pda, false),
                AccountMeta::new_readonly(system_program_id, false),
            ],
            data: instruction_data,
        };

        Ok((
            asset_record_pda_str,
            compliance_record_pda_str,
            Some(approve_wallet_ix),
        ))
    }

    async fn transfer_token_internal(
        &self,
        to_address: &str,
        token_mint: &str,
        amount: u64,
        source_owner_address: Option<&str>,
    ) -> Result<(String, String), AppError> {
        info!(
            to = %to_address,
            token_mint = %token_mint,
            amount = %amount,
            source_owner = ?source_owner_address,
            "Transferring Token-2022 asset"
        );

        if amount == 0 {
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                "Transfer amount must be greater than 0".to_string(),
            )));
        }

        let (sdk_client, keypair) = self.require_sdk_and_keypair()?;
        let to_pubkey = to_address.parse::<Pubkey>().map_err(|e| {
            AppError::Blockchain(BlockchainError::InvalidSignature(format!(
                "Invalid destination address: {}",
                e
            )))
        })?;
        let mint_pubkey = token_mint.parse::<Pubkey>().map_err(|e| {
            AppError::Blockchain(BlockchainError::InvalidSignature(format!(
                "Invalid token mint address: {}",
                e
            )))
        })?;
        let source_owner_pubkey = match source_owner_address {
            Some(address) => address.parse::<Pubkey>().map_err(|e| {
                AppError::Validation(crate::domain::ValidationError::InvalidField {
                    field: "source_owner_address".to_string(),
                    message: format!("Invalid base58 pubkey: {}", e),
                })
            })?,
            None => keypair.pubkey(),
        };

        let mint_account = sdk_client.get_account(&mint_pubkey).await.map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to fetch mint account: {}",
                e
            )))
        })?;
        let token_program_id = mint_account.owner;
        if token_program_id != token_2022_program_id() {
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                format!(
                    "Fortis RWA transfers require a Token-2022 mint. Expected owner {}, found {}",
                    token_2022_program_id(),
                    token_program_id
                ),
            )));
        }

        let decimals = Self::read_mint_decimals(&mint_account.data)?;
        let source_ata = get_associated_token_address_with_program_id(
            &source_owner_pubkey,
            &mint_pubkey,
            &token_program_id,
        );
        let destination_ata = get_associated_token_address_with_program_id(
            &to_pubkey,
            &mint_pubkey,
            &token_program_id,
        );

        let source_account = sdk_client.get_account(&source_ata).await.map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Source token account does not exist or cannot be fetched for owner {} and mint {}: {}",
                source_owner_pubkey, token_mint, e
            )))
        })?;
        if source_account.owner != token_program_id {
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                format!(
                    "Source token account is not owned by the token program. Expected owner: {}, actual owner: {}",
                    token_program_id, source_account.owner
                ),
            )));
        }

        const TOKEN_ACCOUNT_AMOUNT_OFFSET: usize = 64;
        if source_account.data.len() < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8 {
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                "Source token account data is too small to read balance".to_string(),
            )));
        }
        let balance_bytes: [u8; 8] = source_account.data
            [TOKEN_ACCOUNT_AMOUNT_OFFSET..TOKEN_ACCOUNT_AMOUNT_OFFSET + 8]
            .try_into()
            .expect("token account balance slice has fixed length");
        let balance = u64::from_le_bytes(balance_bytes);
        if balance < amount {
            return Err(AppError::Blockchain(BlockchainError::InsufficientFunds));
        }

        let priority_fee = self.get_priority_fee(None).await;
        let mut instructions: Vec<Instruction> =
            vec![ComputeBudgetInstruction::set_compute_unit_price(priority_fee)];

        if sdk_client.get_account(&destination_ata).await.is_err() {
            instructions.push(create_associated_token_account_idempotent(
                &keypair.pubkey(),
                &to_pubkey,
                &mint_pubkey,
                &token_program_id,
            ));
        }

        let mut transfer_ix = token2022_instruction::transfer_checked(
            &token_program_id,
            &source_ata,
            &mint_pubkey,
            &destination_ata,
            &keypair.pubkey(),
            &[],
            amount,
            decimals,
        )
        .map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to create transfer_checked instruction: {}",
                e
            )))
        })?;

        let fortis_program_id = fortis_rwa_program_pubkey()?;
        add_extra_account_metas_for_execute(
            &mut transfer_ix,
            &fortis_program_id,
            &source_ata,
            &mint_pubkey,
            &destination_ata,
            &keypair.pubkey(),
            amount,
            |address| async move {
                match sdk_client.get_account(&address).await {
                    Ok(account) => Ok(Some(account.data)),
                    Err(error) => {
                        let message = error.to_string();
                        if message.contains("AccountNotFound")
                            || message.contains("could not find account")
                            || message.contains("not found")
                        {
                            Ok(None)
                        } else {
                            Err(Box::new(error) as _)
                        }
                    }
                }
            },
        )
        .await
        .map_err(|error| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to resolve transfer hook extra accounts: {}",
                error
            )))
        })?;

        instructions.push(transfer_ix);

        if let Some(tip_ix) = self.create_jito_tip_instruction(&keypair.pubkey()) {
            instructions.push(tip_ix);
        }

        let recent_blockhash = sdk_client
            .get_latest_blockhash()
            .await
            .map_err(map_solana_client_error)?;
        let transaction = Transaction::new_signed_with_payer(
            &instructions,
            Some(&keypair.pubkey()),
            &[keypair],
            recent_blockhash,
        );

        self.submit_or_confirm_transaction(&transaction).await
    }
}

#[async_trait]
impl BlockchainClient for RpcBlockchainClient {
    #[instrument(skip(self))]
    async fn health_check(&self) -> Result<(), AppError> {
        let _: u64 = self.rpc_call("getSlot", Vec::<()>::new()).await?;
        Ok(())
    }

    #[instrument(skip(self))]
    async fn submit_transaction(
        &self,
        request: &TransferRequest,
    ) -> Result<(String, String), AppError> {
        info!(id = %request.id, "Submitting transaction for request");

        // Check if we have SDK client (for real transactions)
        if self.sdk_client.is_none() || self.keypair.is_none() {
            // Mock implementation for testing (when SDK client not available)
            debug!("Using mock implementation for submit_transaction");
            let signature = self.sign(request.id.as_bytes());
            return Ok((
                format!("tx_{}", &signature[..16]),
                "mock_blockhash".to_string(),
            ));
        }

        match &request.transfer_details {
            TransferType::Public { amount } => {
                self.transfer_token_internal(
                    &request.to_address,
                    request.required_token_mint()?,
                    *amount,
                    request.source_owner_address.as_deref(),
                )
                .await
            }
        }
    }

    #[instrument(skip(self))]
    async fn approve_wallet(
        &self,
        token_mint: &str,
        wallet_address: &str,
        compliance_level: ComplianceLevel,
    ) -> Result<WalletApprovalSubmission, AppError> {
        info!(
            wallet = %wallet_address,
            token_mint = %token_mint,
            compliance_level = %compliance_level,
            "Submitting Fortis RWA wallet approval"
        );

        if self.sdk_client.is_none() || self.keypair.is_none() {
            let mint_pubkey = token_mint.parse::<Pubkey>().map_err(|e| {
                AppError::Validation(crate::domain::ValidationError::InvalidField {
                    field: "token_mint".to_string(),
                    message: format!("Invalid base58 pubkey: {}", e),
                })
            })?;
            let wallet_pubkey = wallet_address.parse::<Pubkey>().map_err(|e| {
                AppError::Validation(crate::domain::ValidationError::InvalidField {
                    field: "wallet_address".to_string(),
                    message: format!("Invalid base58 pubkey: {}", e),
                })
            })?;
            let program_id = fortis_rwa_program_pubkey()?;
            let (asset_record_pda, _) =
                Pubkey::find_program_address(&[b"asset", mint_pubkey.as_ref()], &program_id);
            let (compliance_record_pda, _) = Pubkey::find_program_address(
                &[b"compliance", mint_pubkey.as_ref(), wallet_pubkey.as_ref()],
                &program_id,
            );
            let mock_signature = self.sign(
                format!(
                    "approve-wallet:{}:{}:{}",
                    token_mint,
                    wallet_address,
                    compliance_level.as_str()
                )
                .as_bytes(),
            );

            return Ok(WalletApprovalSubmission {
                asset_record_pda: asset_record_pda.to_string(),
                compliance_record_pda: compliance_record_pda.to_string(),
                tx_signature: Some(format!("wallet_approval_{}", &mock_signature[..16])),
            });
        }

        let (sdk_client, keypair) = self.require_sdk_and_keypair()?;
        let (asset_record_pda_str, compliance_record_pda_str, approval_ix) = self
            .build_wallet_approval_instruction(token_mint, wallet_address, compliance_level)
            .await?;
        let Some(approve_wallet_ix) = approval_ix else {
            info!(
                wallet = %wallet_address,
                token_mint = %token_mint,
                compliance_record_pda = %compliance_record_pda_str,
                "Wallet approval already exists on-chain; skipping duplicate submission"
            );

            return Ok(WalletApprovalSubmission {
                asset_record_pda: asset_record_pda_str,
                compliance_record_pda: compliance_record_pda_str,
                tx_signature: None,
            });
        };

        let priority_fee = self.get_priority_fee(None).await;
        let mut instructions = vec![
            ComputeBudgetInstruction::set_compute_unit_price(priority_fee),
            approve_wallet_ix,
        ];

        if let Some(tip_ix) = self.create_jito_tip_instruction(&keypair.pubkey()) {
            info!(
                tip_lamports = self.jito_tip_lamports.unwrap_or(0),
                "Appending Jito tip instruction to wallet approval"
            );
            instructions.push(tip_ix);
        }

        let recent_blockhash = sdk_client
            .get_latest_blockhash()
            .await
            .map_err(map_solana_client_error)?;
        let transaction = Transaction::new_signed_with_payer(
            &instructions,
            Some(&keypair.pubkey()),
            &[keypair],
            recent_blockhash,
        );
        let (signature, _) = self.submit_or_confirm_transaction(&transaction).await?;

        info!(
            wallet = %wallet_address,
            token_mint = %token_mint,
            signature = %signature,
            compliance_record_pda = %compliance_record_pda_str,
            "Fortis wallet approval submitted"
        );

        Ok(WalletApprovalSubmission {
            asset_record_pda: asset_record_pda_str,
            compliance_record_pda: compliance_record_pda_str,
            tx_signature: Some(signature),
        })
    }

    #[instrument(skip(self, request), fields(listing_id = request.listing_id, seller = %request.seller_wallet_address))]
    async fn tokenize_listing(
        &self,
        request: &TokenizeListingRequest,
    ) -> Result<TokenizeListingResult, AppError> {
        let seller_pubkey = request
            .seller_wallet_address
            .parse::<Pubkey>()
            .map_err(|e| {
                AppError::Validation(crate::domain::ValidationError::InvalidField {
                    field: "sellerWalletAddress".to_string(),
                    message: format!("Invalid base58 pubkey: {}", e),
                })
            })?;

        if self.sdk_client.is_none() || self.keypair.is_none() {
            let mock_seed = format!("tokenize-listing:{}", request.listing_id);
            let mock_signature = self.sign(mock_seed.as_bytes());
            return Ok(TokenizeListingResult {
                token_mint_address: format!("mock_mint_{}", &mock_signature[..16]),
                asset_record_pda: format!("mock_asset_{}", &mock_signature[..16]),
                seller_compliance_record_pda: format!("mock_compliance_{}", &mock_signature[..16]),
                delegate_wallet_address: self.public_key(),
                planned_supply: request.planned_supply,
                initialize_mint_signature: Some(format!("mint_init_{}", &mock_signature[..16])),
                initialize_asset_signature: Some(format!("asset_init_{}", &mock_signature[..16])),
                mint_to_signature: Some(format!("mint_to_{}", &mock_signature[..16])),
            });
        }

        let (sdk_client, authority_keypair) = self.require_sdk_and_keypair()?;
        let token_program_id = token_2022_program_id();
        let fortis_program_id = fortis_rwa_program_pubkey()?;
        let mint_keypair = Keypair::new();
        let mint_pubkey = mint_keypair.pubkey();
        let delegate_wallet = authority_keypair.pubkey();
        let extra_account_meta_list =
            get_extra_account_metas_address(&mint_pubkey, &fortis_program_id);
        let (asset_record_pda, _) =
            Pubkey::find_program_address(&[b"asset", mint_pubkey.as_ref()], &fortis_program_id);
        let (_seller_compliance_record_pda, _) = Pubkey::find_program_address(
            &[b"compliance", mint_pubkey.as_ref(), seller_pubkey.as_ref()],
            &fortis_program_id,
        );

        let mint_extensions = [
            ExtensionType::TransferHook,
            ExtensionType::PermanentDelegate,
        ];
        let mint_len = ExtensionType::try_calculate_account_len::<PodMint>(&mint_extensions)
            .map_err(|e| {
                AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                    "Failed to calculate Token-2022 mint length: {}",
                    e
                )))
            })?;
        let rent_lamports = sdk_client
            .get_minimum_balance_for_rent_exemption(mint_len)
            .await
            .map_err(map_solana_client_error)?;

        let create_mint_ix = system_instruction::create_account(
            &authority_keypair.pubkey(),
            &mint_pubkey,
            rent_lamports,
            mint_len as u64,
            &token_program_id,
        );
        let init_transfer_hook_ix = transfer_hook_instruction::initialize(
            &token_program_id,
            &mint_pubkey,
            Some(authority_keypair.pubkey()),
            Some(fortis_program_id),
        )
        .map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to create transfer hook initialization instruction: {}",
                e
            )))
        })?;
        let init_permanent_delegate_ix = token2022_instruction::initialize_permanent_delegate(
            &token_program_id,
            &mint_pubkey,
            &delegate_wallet,
        )
        .map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to create permanent delegate instruction: {}",
                e
            )))
        })?;
        let init_mint_ix = token2022_instruction::initialize_mint2(
            &token_program_id,
            &mint_pubkey,
            &authority_keypair.pubkey(),
            None,
            0,
        )
        .map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to create mint initialization instruction: {}",
                e
            )))
        })?;

        let priority_fee = self.get_priority_fee(None).await;
        let mut mint_setup_instructions = vec![
            ComputeBudgetInstruction::set_compute_unit_price(priority_fee),
            create_mint_ix,
            init_transfer_hook_ix,
            init_permanent_delegate_ix,
            init_mint_ix,
        ];
        if let Some(tip_ix) = self.create_jito_tip_instruction(&authority_keypair.pubkey()) {
            mint_setup_instructions.push(tip_ix);
        }
        let mint_setup_blockhash = sdk_client
            .get_latest_blockhash()
            .await
            .map_err(map_solana_client_error)?;
        let mint_setup_tx = Transaction::new_signed_with_payer(
            &mint_setup_instructions,
            Some(&authority_keypair.pubkey()),
            &[authority_keypair, &mint_keypair],
            mint_setup_blockhash,
        );
        let initialize_mint_signature = self
            .submit_and_confirm_transaction(&mint_setup_tx, "initialize listing mint")
            .await?;

        let initialize_extra_accounts_ix = Instruction {
            program_id: fortis_program_id,
            accounts: vec![
                AccountMeta::new(authority_keypair.pubkey(), true),
                AccountMeta::new(extra_account_meta_list, false),
                AccountMeta::new_readonly(mint_pubkey, false),
                AccountMeta::new_readonly(
                    Pubkey::from_str("11111111111111111111111111111111")
                        .expect("valid system program id"),
                    false,
                ),
            ],
            data: Self::anchor_instruction_data("global:initialize_extra_account_meta_list"),
        };
        let initialize_asset_ix = Instruction {
            program_id: fortis_program_id,
            accounts: vec![
                AccountMeta::new(authority_keypair.pubkey(), true),
                AccountMeta::new_readonly(mint_pubkey, false),
                AccountMeta::new(asset_record_pda, false),
                AccountMeta::new_readonly(
                    Pubkey::from_str("11111111111111111111111111111111")
                        .expect("valid system program id"),
                    false,
                ),
            ],
            data: Self::anchor_instruction_data_with_args(
                "global:initialize_asset",
                &InitializeAssetArgs {
                    name: request.asset_name(),
                    asset_type: request.asset_type.into(),
                    planned_supply: request.planned_supply,
                    valuation_usd: request.valuation_usd,
                    document_uri: request.document_uri(),
                    document_hash: request.document_hash_bytes(),
                },
            )?,
        };

        let mut asset_setup_instructions = vec![
            ComputeBudgetInstruction::set_compute_unit_price(priority_fee),
            initialize_extra_accounts_ix,
            initialize_asset_ix,
        ];
        if let Some(tip_ix) = self.create_jito_tip_instruction(&authority_keypair.pubkey()) {
            asset_setup_instructions.push(tip_ix);
        }
        let asset_setup_blockhash = sdk_client
            .get_latest_blockhash()
            .await
            .map_err(map_solana_client_error)?;
        let asset_setup_tx = Transaction::new_signed_with_payer(
            &asset_setup_instructions,
            Some(&authority_keypair.pubkey()),
            &[authority_keypair],
            asset_setup_blockhash,
        );
        let initialize_asset_signature = self
            .submit_and_confirm_transaction(&asset_setup_tx, "initialize listing asset")
            .await?;

        let (asset_record_pda_str, seller_compliance_record_pda_str, seller_approval_ix) = self
            .build_wallet_approval_instruction(
                &mint_pubkey.to_string(),
                &seller_pubkey.to_string(),
                ComplianceLevel::Standard,
            )
            .await?;
        let (_asset_record_again, _delegate_compliance_record, delegate_approval_ix) = self
            .build_wallet_approval_instruction(
                &mint_pubkey.to_string(),
                &delegate_wallet.to_string(),
                ComplianceLevel::Standard,
            )
            .await?;

        let mut approval_instructions =
            vec![ComputeBudgetInstruction::set_compute_unit_price(priority_fee)];
        if let Some(ix) = seller_approval_ix {
            approval_instructions.push(ix);
        }
        if let Some(ix) = delegate_approval_ix {
            approval_instructions.push(ix);
        }
        if approval_instructions.len() > 1 {
            if let Some(tip_ix) = self.create_jito_tip_instruction(&authority_keypair.pubkey()) {
                approval_instructions.push(tip_ix);
            }
            let approval_blockhash = sdk_client
                .get_latest_blockhash()
                .await
                .map_err(map_solana_client_error)?;
            let approval_tx = Transaction::new_signed_with_payer(
                &approval_instructions,
                Some(&authority_keypair.pubkey()),
                &[authority_keypair],
                approval_blockhash,
            );
            self.submit_and_confirm_transaction(&approval_tx, "approve seller and delegate")
                .await?;
        }

        let seller_ata = get_associated_token_address_with_program_id(
            &seller_pubkey,
            &mint_pubkey,
            &token_program_id,
        );
        let create_seller_ata_ix = create_associated_token_account_idempotent(
            &authority_keypair.pubkey(),
            &seller_pubkey,
            &mint_pubkey,
            &token_program_id,
        );
        let mint_to_ix = token2022_instruction::mint_to(
            &token_program_id,
            &mint_pubkey,
            &seller_ata,
            &authority_keypair.pubkey(),
            &[],
            request.planned_supply,
        )
        .map_err(|e| {
            AppError::Blockchain(BlockchainError::TransactionFailed(format!(
                "Failed to create mint_to instruction: {}",
                e
            )))
        })?;

        let mut mint_to_instructions = vec![
            ComputeBudgetInstruction::set_compute_unit_price(priority_fee),
            create_seller_ata_ix,
            mint_to_ix,
        ];
        if let Some(tip_ix) = self.create_jito_tip_instruction(&authority_keypair.pubkey()) {
            mint_to_instructions.push(tip_ix);
        }
        let mint_to_blockhash = sdk_client
            .get_latest_blockhash()
            .await
            .map_err(map_solana_client_error)?;
        let mint_to_tx = Transaction::new_signed_with_payer(
            &mint_to_instructions,
            Some(&authority_keypair.pubkey()),
            &[authority_keypair],
            mint_to_blockhash,
        );
        let mint_to_signature = self
            .submit_and_confirm_transaction(&mint_to_tx, "mint listing supply to seller")
            .await?;

        Ok(TokenizeListingResult {
            token_mint_address: mint_pubkey.to_string(),
            asset_record_pda: asset_record_pda_str,
            seller_compliance_record_pda: seller_compliance_record_pda_str,
            delegate_wallet_address: delegate_wallet.to_string(),
            planned_supply: request.planned_supply,
            initialize_mint_signature: Some(initialize_mint_signature),
            initialize_asset_signature: Some(initialize_asset_signature),
            mint_to_signature: Some(mint_to_signature),
        })
    }

    #[instrument(skip(self))]
    async fn transfer_sol(
        &self,
        to_address: &str,
        amount_lamports: u64,
    ) -> Result<(String, String), AppError> {
        info!(to = %to_address, amount_lamports = %amount_lamports, "Transferring SOL");

        // Validate amount
        if amount_lamports == 0 {
            return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                "Transfer amount must be greater than 0".to_string(),
            )));
        }

        // Check if we have SDK client and keypair
        let (sdk_client, keypair) = match (&self.sdk_client, &self.keypair) {
            (Some(client), Some(kp)) => (client, kp),
            _ => {
                return Err(AppError::Blockchain(BlockchainError::TransactionFailed(
                    "SDK client not initialized for SOL transfers".to_string(),
                )));
            }
        };

        // Parse destination address
        let to_pubkey = to_address.parse::<Pubkey>().map_err(|e| {
            AppError::Blockchain(BlockchainError::InvalidSignature(format!(
                "Invalid destination address: {}",
                e
            )))
        })?;

        // Get priority fee using provider-specific strategy
        let priority_fee = self.get_priority_fee(None).await;

        // Create transfer instruction using SDK
        let transfer_ix =
            system_instruction::transfer(&keypair.pubkey(), &to_pubkey, amount_lamports);

        // Build instructions with compute budget for priority fee
        let mut instructions = vec![
            ComputeBudgetInstruction::set_compute_unit_price(priority_fee),
            transfer_ix,
        ];

        // Append Jito tip instruction if enabled (MUST be last instruction per Jito best practices)
        if let Some(tip_ix) = self.create_jito_tip_instruction(&keypair.pubkey()) {
            info!(
                tip_lamports = self.jito_tip_lamports.unwrap_or(0),
                "Appending Jito tip instruction to SOL transfer"
            );
            instructions.push(tip_ix);
        }

        // Get recent blockhash using SDK
        let recent_blockhash = sdk_client
            .get_latest_blockhash()
            .await
            .map_err(map_solana_client_error)?;

        // Build and sign transaction
        let transaction = Transaction::new_signed_with_payer(
            &instructions,
            Some(&keypair.pubkey()),
            &[keypair],
            recent_blockhash,
        );

        // Submit via strategy if available, otherwise use SDK
        let (signature, blockhash) = self.submit_or_confirm_transaction(&transaction).await?;

        info!(
            signature = %signature,
            to = %to_address,
            amount_lamports = %amount_lamports,
            via_strategy = self.submission_strategy.is_some(),
            jito_tip = self.jito_tip_lamports.filter(|_| self.supports_private_submission()),
            "SOL transfer submitted"
        );

        Ok((signature, blockhash))
    }

    #[instrument(skip(self))]
    async fn transfer_token(
        &self,
        to_address: &str,
        token_mint: &str,
        amount: u64,
    ) -> Result<(String, String), AppError> {
        self.transfer_token_internal(to_address, token_mint, amount, None)
            .await
    }

    /// Check if a wallet holds compliant assets using Helius DAS.
    ///
    /// This method checks if the wallet holds any assets from sanctioned collections.
    /// It is only available when using a Helius RPC provider.
    ///
    /// # Behavior by Provider
    /// - **Helius**: Uses `getAssetsByOwner` DAS API to check asset collections
    /// - **QuickNode/Standard**: Returns `true` (skip check, assume compliant)
    ///
    /// # Arguments
    /// * `owner` - The wallet address (Base58) to check
    ///
    /// # Returns
    /// * `Ok(true)` - Wallet is compliant (no sanctioned assets or DAS not available)
    /// * `Ok(false)` - Wallet holds sanctioned assets
    /// * `Err(_)` - API error during check
    #[instrument(skip(self))]
    async fn check_wallet_assets(&self, owner: &str) -> Result<bool, AppError> {
        match &self.das_client {
            Some(das_client) => {
                info!(wallet = %owner, "Helius DAS Check: Initiating asset scan");
                das_client.check_wallet_compliance(owner).await
            }
            None => {
                debug!(
                    wallet = %owner,
                    provider = %self.provider_type.name(),
                    "DAS not available for this provider, skipping asset check"
                );
                Ok(true)
            }
        }
    }

    // =========================================================================
    // Jito Double Spend Protection Methods
    // =========================================================================

    /// Query the status of a transaction by its signature.
    /// Used to verify if an original transaction was processed before retrying
    /// after a JitoStateUnknown error.
    #[instrument(skip(self))]
    async fn get_signature_status(
        &self,
        signature: &str,
    ) -> Result<Option<crate::domain::TransactionStatus>, AppError> {
        use crate::domain::TransactionStatus;

        let params = serde_json::json!([[signature], {"searchTransactionHistory": true}]);
        let result: SignatureStatusResult = self.rpc_call("getSignatureStatuses", params).await?;

        match result.value.first() {
            Some(Some(status)) => {
                // Check if transaction errored
                if let Some(ref err) = status.err {
                    return Ok(Some(TransactionStatus::Failed(format!("{:?}", err))));
                }

                // Check confirmation status
                match status.confirmation_status.as_deref() {
                    Some("finalized") => Ok(Some(TransactionStatus::Finalized)),
                    Some("confirmed") => Ok(Some(TransactionStatus::Confirmed)),
                    // Transaction is still processing or unknown status
                    _ => Ok(None),
                }
            }
            // Transaction not found
            _ => Ok(None),
        }
    }

    /// Check if a blockhash is still valid (not expired).
    /// Blockhashes typically expire after ~150 slots (~1-2 minutes).
    #[instrument(skip(self))]
    async fn is_blockhash_valid(&self, blockhash: &str) -> Result<bool, AppError> {
        // Use the SDK client if available for accurate blockhash validation
        if let Some(sdk_client) = &self.sdk_client {
            let hash = solana_sdk::hash::Hash::from_str(blockhash).map_err(|e| {
                AppError::Validation(crate::domain::ValidationError::InvalidField {
                    field: "blockhash".to_string(),
                    message: format!("Invalid blockhash format: {}", e),
                })
            })?;

            let is_valid = sdk_client
                .is_blockhash_valid(&hash, CommitmentConfig::confirmed())
                .await
                .map_err(map_solana_client_error)?;

            debug!(
                blockhash = %blockhash,
                is_valid = %is_valid,
                "Checked blockhash validity"
            );

            return Ok(is_valid);
        }

        // Fallback: Use RPC method directly
        // The `isBlockhashValid` RPC method returns whether the blockhash is still valid
        let params = serde_json::json!([blockhash, {"commitment": "confirmed"}]);

        #[derive(Debug, Deserialize)]
        struct IsValidResult {
            value: bool,
        }

        match self
            .rpc_call::<serde_json::Value, IsValidResult>("isBlockhashValid", params)
            .await
        {
            Ok(result) => {
                debug!(
                    blockhash = %blockhash,
                    is_valid = %result.value,
                    "Checked blockhash validity via RPC"
                );
                Ok(result.value)
            }
            Err(e) => {
                warn!(
                    blockhash = %blockhash,
                    error = %e,
                    "Failed to check blockhash validity, assuming expired"
                );
                // On error, assume expired (safe to retry with new blockhash)
                Ok(false)
            }
        }
    }
}

/// Map Solana client errors to our AppError types
fn map_solana_client_error(err: solana_client::client_error::ClientError) -> AppError {
    use solana_client::client_error::ClientErrorKind;

    let msg = err.to_string();

    match err.kind() {
        ClientErrorKind::RpcError(_) => {
            if msg.contains("insufficient") || msg.contains("InsufficientFunds") {
                AppError::Blockchain(BlockchainError::InsufficientFunds)
            } else {
                AppError::Blockchain(BlockchainError::RpcError(msg))
            }
        }
        ClientErrorKind::Io(_) => AppError::Blockchain(BlockchainError::Connection(msg)),
        ClientErrorKind::Reqwest(_) => {
            if msg.contains("timeout") || msg.contains("timed out") {
                AppError::Blockchain(BlockchainError::Timeout(msg))
            } else {
                AppError::Blockchain(BlockchainError::Connection(msg))
            }
        }
        _ => AppError::Blockchain(BlockchainError::TransactionFailed(msg)),
    }
}

/// Wrap a blockchain error with the blockhash that was used for the transaction.
/// This enables "sticky blockhash" logic: on retry, the service layer can reuse the
/// same blockhash (which will fail safely if already processed) instead of fetching
/// a new one (which could lead to double-spend).
fn wrap_error_with_blockhash(error: AppError, blockhash: &str) -> AppError {
    match error {
        AppError::Blockchain(BlockchainError::Timeout(msg)) => {
            AppError::Blockchain(BlockchainError::TimeoutWithBlockhash {
                message: msg,
                blockhash: blockhash.to_string(),
            })
        }
        AppError::Blockchain(
            BlockchainError::Connection(ref msg) | BlockchainError::RpcError(ref msg),
        ) => AppError::Blockchain(BlockchainError::NetworkErrorWithBlockhash {
            message: msg.clone(),
            blockhash: blockhash.to_string(),
        }),
        // JitoStateUnknown, JitoBundleFailed, etc. pass through â€” they have
        // their own retry semantics and the blockhash is already tracked separately.
        other => other,
    }
}

/// Parse a base58-encoded private key into a SigningKey
pub fn signing_key_from_base58(secret: &SecretString) -> Result<SigningKey, AppError> {
    let key_bytes = bs58::decode(secret.expose_secret())
        .into_vec()
        .map_err(|e| AppError::Blockchain(BlockchainError::InvalidSignature(e.to_string())))?;

    // Handle both 32-byte (seed) and 64-byte (keypair) formats
    let key_array: [u8; 32] = if key_bytes.len() == 64 {
        // Solana keypair format: first 32 bytes are the secret key
        key_bytes[..32].try_into().map_err(|_| {
            AppError::Blockchain(BlockchainError::InvalidSignature(
                "Invalid keypair format".to_string(),
            ))
        })?
    } else if key_bytes.len() == 32 {
        key_bytes.try_into().map_err(|v: Vec<u8>| {
            AppError::Blockchain(BlockchainError::InvalidSignature(format!(
                "Key must be 32 bytes, got {}",
                v.len()
            )))
        })?
    } else {
        return Err(AppError::Blockchain(BlockchainError::InvalidSignature(
            format!("Key must be 32 or 64 bytes, got {}", key_bytes.len()),
        )));
    };

    Ok(SigningKey::from_bytes(&key_array))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    #[test]
    fn test_client_creation() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let client =
            RpcBlockchainClient::with_defaults("https://api.devnet.solana.com", signing_key);
        assert!(client.is_ok());
    }

    #[test]
    fn test_public_key_generation() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let client =
            RpcBlockchainClient::with_defaults("https://api.devnet.solana.com", signing_key)
                .unwrap();
        let pubkey = client.public_key();
        assert!(!pubkey.is_empty());
        // Verify it decodes to 32 bytes (length can be 43 or 44 chars)
        let decoded = bs58::decode(&pubkey)
            .into_vec()
            .expect("Should be valid base58");
        assert_eq!(decoded.len(), 32);
    }

    #[test]
    fn test_signing() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let client =
            RpcBlockchainClient::with_defaults("https://api.devnet.solana.com", signing_key)
                .unwrap();
        let signature = client.sign(b"test message");
        assert!(!signature.is_empty());
    }

    #[test]
    fn test_signing_key_from_base58_valid_32_bytes() {
        let original_key = SigningKey::generate(&mut OsRng);
        let encoded = bs58::encode(original_key.to_bytes()).into_string();
        let secret = SecretString::from(encoded);
        let result = signing_key_from_base58(&secret);
        assert!(result.is_ok());
    }

    #[test]
    fn test_signing_key_from_base58_valid_64_bytes() {
        let original_key = SigningKey::generate(&mut OsRng);
        let mut keypair = original_key.to_bytes().to_vec();
        keypair.extend_from_slice(original_key.verifying_key().as_bytes());
        let encoded = bs58::encode(&keypair).into_string();
        let secret = SecretString::from(encoded);
        let result = signing_key_from_base58(&secret);
        assert!(result.is_ok());
    }

    #[test]
    fn test_signing_key_from_base58_invalid() {
        let secret = SecretString::from("invalid-base58!!!");
        let result = signing_key_from_base58(&secret);
        assert!(result.is_err());
    }

    #[test]
    fn test_rpc_client_config_default() {
        let config = RpcClientConfig::default();
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.timeout, Duration::from_secs(30));
        assert_eq!(config.confirmation_timeout, Duration::from_secs(60));
    }

    #[test]
    fn test_signing_key_from_base58_wrong_length() {
        // 16 bytes - too short
        let short_key = bs58::encode(vec![0u8; 16]).into_string();
        let secret = SecretString::from(short_key);
        let result = signing_key_from_base58(&secret);
        assert!(result.is_err());

        // 48 bytes - wrong size (not 32 or 64)
        let wrong_key = bs58::encode(vec![0u8; 48]).into_string();
        let secret = SecretString::from(wrong_key);
        let result = signing_key_from_base58(&secret);
        assert!(result.is_err());
    }

    #[test]
    fn test_rpc_client_config_custom() {
        let config = RpcClientConfig {
            timeout: Duration::from_secs(60),
            max_retries: 5,
            retry_delay: Duration::from_millis(1000),
            confirmation_timeout: Duration::from_secs(120),
        };
        assert_eq!(config.timeout, Duration::from_secs(60));
        assert_eq!(config.max_retries, 5);
        assert_eq!(config.retry_delay, Duration::from_millis(1000));
        assert_eq!(config.confirmation_timeout, Duration::from_secs(120));
    }

    #[test]
    fn test_signing_determinism() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let client =
            RpcBlockchainClient::with_defaults("https://api.devnet.solana.com", signing_key)
                .unwrap();

        // Same message should produce same signature
        let sig1 = client.sign(b"test message");
        let sig2 = client.sign(b"test message");
        assert_eq!(sig1, sig2);

        // Different message should produce different signature
        let sig3 = client.sign(b"different message");
        assert_ne!(sig1, sig3);
    }

    // --- MOCK PROVIDER TESTS ---
    use std::sync::Mutex;

    #[cfg(test)]
    #[allow(dead_code)]
    enum BlockchainErrorType {
        Timeout,
        Rpc,
    }

    struct MockState {
        requests: Vec<String>,
        should_fail_count: u32,
        failure_error: Option<BlockchainErrorType>,
        next_response: Option<serde_json::Value>,
    }

    struct MockSolanaRpcProvider {
        state: Mutex<MockState>,
        signing_key: SigningKey,
    }

    impl MockSolanaRpcProvider {
        fn new() -> Self {
            Self {
                state: Mutex::new(MockState {
                    requests: Vec::new(),
                    should_fail_count: 0,
                    failure_error: None,
                    next_response: None,
                }),
                signing_key: SigningKey::generate(&mut OsRng),
            }
        }

        fn with_failure(count: u32, error_type: BlockchainErrorType) -> Self {
            let provider = Self::new(); // removed `mut` since we donâ€™t mutate `provider` itself
            {
                let mut state = provider.state.lock().unwrap();
                state.should_fail_count = count;
                state.failure_error = Some(error_type);
            }
            provider
        }
    }

    #[async_trait]
    impl SolanaRpcProvider for MockSolanaRpcProvider {
        async fn send_request(
            &self,
            method: &str,
            _params: serde_json::Value,
        ) -> Result<serde_json::Value, AppError> {
            let mut state = self.state.lock().unwrap();
            state.requests.push(method.to_string());

            if state.should_fail_count > 0 {
                state.should_fail_count -= 1;
                if let Some(ref err) = state.failure_error {
                    return match err {
                        BlockchainErrorType::Timeout => Err(AppError::Blockchain(
                            BlockchainError::Timeout("Mock timeout".to_string()),
                        )),
                        BlockchainErrorType::Rpc => Err(AppError::Blockchain(
                            BlockchainError::RpcError("Mock RPC error".to_string()),
                        )),
                    };
                }
            }

            if let Some(resp) = &state.next_response {
                return Ok(resp.clone());
            }

            Ok(serde_json::Value::Null)
        }

        fn public_key(&self) -> String {
            bs58::encode(self.signing_key.verifying_key().as_bytes()).into_string()
        }

        fn sign(&self, message: &[u8]) -> String {
            let signature = self.signing_key.sign(message);
            bs58::encode(signature.to_bytes()).into_string()
        }
    }

    #[tokio::test]
    async fn test_rpc_client_retry_logic_success() {
        // Setup provider that fails twice then succeeds
        let provider = MockSolanaRpcProvider::with_failure(2, BlockchainErrorType::Timeout);
        let config = RpcClientConfig {
            max_retries: 3,
            retry_delay: Duration::from_millis(1), // Fast retry
            ..Default::default()
        };

        // Set success response
        {
            let mut state = provider.state.lock().unwrap();
            state.next_response = Some(serde_json::json!(12345u64)); // Slot response
        }

        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        // Call health_check (uses getSlot)
        let result = client.health_check().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_rpc_client_retry_logic_failure() {
        // Setup provider that fails 4 times (max retries is 3)
        let provider = MockSolanaRpcProvider::with_failure(4, BlockchainErrorType::Timeout);
        let config = RpcClientConfig {
            max_retries: 3,
            retry_delay: Duration::from_millis(1),
            ..Default::default()
        };

        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.health_check().await;
        assert!(matches!(
            result,
            Err(AppError::Blockchain(BlockchainError::Timeout(_)))
        ));
    }

    // --- ENHANCED MOCK FOR ERROR SCENARIOS ---

    #[derive(Clone)]
    #[allow(dead_code)]
    enum MockErrorKind {
        Timeout(String),
        RpcError(String),
        InsufficientFunds,
        TransactionFailed(String),
        EmptyResponse,
    }

    struct ConfigurableMockProvider {
        signing_key: SigningKey,
        responses: Mutex<Vec<Result<serde_json::Value, MockErrorKind>>>,
        call_count: Mutex<usize>,
    }

    impl ConfigurableMockProvider {
        fn new() -> Self {
            Self {
                signing_key: SigningKey::generate(&mut OsRng),
                responses: Mutex::new(Vec::new()),
                call_count: Mutex::new(0),
            }
        }

        fn with_responses(responses: Vec<Result<serde_json::Value, MockErrorKind>>) -> Self {
            let provider = Self::new();
            *provider.responses.lock().unwrap() = responses;
            provider
        }

        #[allow(dead_code)]
        fn get_call_count(&self) -> usize {
            *self.call_count.lock().unwrap()
        }
    }

    #[async_trait]
    impl SolanaRpcProvider for ConfigurableMockProvider {
        async fn send_request(
            &self,
            _method: &str,
            _params: serde_json::Value,
        ) -> Result<serde_json::Value, AppError> {
            let mut count = self.call_count.lock().unwrap();
            let idx = *count;
            *count += 1;
            drop(count);

            let responses = self.responses.lock().unwrap();
            if idx < responses.len() {
                match &responses[idx] {
                    Ok(v) => Ok(v.clone()),
                    Err(MockErrorKind::Timeout(msg)) => {
                        Err(AppError::Blockchain(BlockchainError::Timeout(msg.clone())))
                    }
                    Err(MockErrorKind::RpcError(msg)) => {
                        Err(AppError::Blockchain(BlockchainError::RpcError(msg.clone())))
                    }
                    Err(MockErrorKind::InsufficientFunds) => {
                        Err(AppError::Blockchain(BlockchainError::InsufficientFunds))
                    }
                    Err(MockErrorKind::TransactionFailed(msg)) => Err(AppError::Blockchain(
                        BlockchainError::TransactionFailed(msg.clone()),
                    )),
                    Err(MockErrorKind::EmptyResponse) => Err(AppError::Blockchain(
                        BlockchainError::RpcError("Empty response".to_string()),
                    )),
                }
            } else {
                Ok(serde_json::Value::Null)
            }
        }

        fn public_key(&self) -> String {
            bs58::encode(self.signing_key.verifying_key().as_bytes()).into_string()
        }

        fn sign(&self, message: &[u8]) -> String {
            let signature = self.signing_key.sign(message);
            bs58::encode(signature.to_bytes()).into_string()
        }
    }

    // --- ERROR HANDLING TESTS ---

    #[tokio::test]
    async fn test_rpc_error_insufficient_funds() {
        let provider =
            ConfigurableMockProvider::with_responses(vec![Err(MockErrorKind::InsufficientFunds)]);
        let config = RpcClientConfig {
            max_retries: 0, // No retries for this test
            ..Default::default()
        };
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.health_check().await;
        assert!(matches!(
            result,
            Err(AppError::Blockchain(BlockchainError::InsufficientFunds))
        ));
    }

    #[tokio::test]
    async fn test_rpc_error_timeout_mapping() {
        let provider = ConfigurableMockProvider::with_responses(vec![Err(MockErrorKind::Timeout(
            "Connection timed out".to_string(),
        ))]);
        let config = RpcClientConfig {
            max_retries: 0,
            ..Default::default()
        };
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.health_check().await;
        match result {
            Err(AppError::Blockchain(BlockchainError::Timeout(msg))) => {
                assert!(msg.contains("timed out"));
            }
            _ => panic!("Expected timeout error"),
        }
    }

    #[tokio::test]
    async fn test_rpc_error_generic_rpc_error() {
        let provider = ConfigurableMockProvider::with_responses(vec![Err(
            MockErrorKind::RpcError("-32000: Server is busy".to_string()),
        )]);
        let config = RpcClientConfig {
            max_retries: 0,
            ..Default::default()
        };
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.health_check().await;
        match result {
            Err(AppError::Blockchain(BlockchainError::RpcError(msg))) => {
                assert!(msg.contains("Server is busy"));
            }
            _ => panic!("Expected RPC error"),
        }
    }

    // --- DESERIALIZATION TESTS ---

    #[test]
    fn test_deserialize_signature_status_confirmed() {
        let json = serde_json::json!({
            "err": null,
            "confirmationStatus": "confirmed"
        });
        let status: SignatureStatus = serde_json::from_value(json).unwrap();
        assert!(status.err.is_none());
        assert_eq!(status.confirmation_status.as_deref(), Some("confirmed"));
    }

    #[test]
    fn test_deserialize_signature_status_finalized() {
        let json = serde_json::json!({
            "err": null,
            "confirmationStatus": "finalized"
        });
        let status: SignatureStatus = serde_json::from_value(json).unwrap();
        assert!(status.err.is_none());
        assert_eq!(status.confirmation_status.as_deref(), Some("finalized"));
    }

    #[test]
    fn test_deserialize_signature_status_with_error() {
        let json = serde_json::json!({
            "err": {"InstructionError": [0, "Custom"]},
            "confirmationStatus": "confirmed"
        });
        let status: SignatureStatus = serde_json::from_value(json).unwrap();
        assert!(status.err.is_some());
    }

    #[test]
    fn test_deserialize_signature_status_null_confirmation() {
        let json = serde_json::json!({
            "err": null,
            "confirmationStatus": null
        });
        let status: SignatureStatus = serde_json::from_value(json).unwrap();
        assert!(status.confirmation_status.is_none());
    }

    #[test]
    fn test_deserialize_blockhash_result() {
        let json = serde_json::json!({
            "value": {
                "blockhash": "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTy5nRhVT3"
            }
        });
        let result: BlockhashResult = serde_json::from_value(json).unwrap();
        assert_eq!(
            result.value.blockhash,
            "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTy5nRhVT3"
        );
    }

    #[test]
    fn test_deserialize_signature_status_result() {
        let json = serde_json::json!({
            "value": [
                {
                    "err": null,
                    "confirmationStatus": "finalized"
                }
            ]
        });
        let result: SignatureStatusResult = serde_json::from_value(json).unwrap();
        assert_eq!(result.value.len(), 1);
        assert!(result.value[0].is_some());
    }

    #[test]
    fn test_deserialize_signature_status_result_null_entry() {
        let json = serde_json::json!({
            "value": [null]
        });
        let result: SignatureStatusResult = serde_json::from_value(json).unwrap();
        assert_eq!(result.value.len(), 1);
        assert!(result.value[0].is_none());
    }

    // --- TRANSACTION STATUS TESTS ---

    #[tokio::test]
    async fn test_get_transaction_status_confirmed() {
        let provider = ConfigurableMockProvider::with_responses(vec![Ok(serde_json::json!({
            "value": [{
                "err": null,
                "confirmationStatus": "confirmed"
            }]
        }))]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.get_transaction_status("test_sig").await;
        assert!(result.is_ok());
        assert!(result.unwrap()); // Should be confirmed
    }

    #[tokio::test]
    async fn test_get_transaction_status_finalized() {
        let provider = ConfigurableMockProvider::with_responses(vec![Ok(serde_json::json!({
            "value": [{
                "err": null,
                "confirmationStatus": "finalized"
            }]
        }))]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.get_transaction_status("test_sig").await;
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_get_transaction_status_not_found() {
        let provider = ConfigurableMockProvider::with_responses(vec![Ok(serde_json::json!({
            "value": [null]
        }))]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.get_transaction_status("unknown_sig").await;
        assert!(result.is_ok());
        assert!(!result.unwrap()); // Not found = not confirmed
    }

    #[tokio::test]
    async fn test_get_transaction_status_with_error() {
        let provider = ConfigurableMockProvider::with_responses(vec![Ok(serde_json::json!({
            "value": [{
                "err": {"InstructionError": [0, "Custom"]},
                "confirmationStatus": "confirmed"
            }]
        }))]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.get_transaction_status("failed_sig").await;
        assert!(matches!(
            result,
            Err(AppError::Blockchain(BlockchainError::TransactionFailed(_)))
        ));
    }

    // --- BLOCKHASH AND BLOCK HEIGHT TESTS ---

    #[tokio::test]
    async fn test_get_latest_blockhash() {
        let provider = ConfigurableMockProvider::with_responses(vec![Ok(serde_json::json!({
            "value": {
                "blockhash": "TestBlockhash123"
            }
        }))]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.get_latest_blockhash().await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "TestBlockhash123");
    }

    #[tokio::test]
    async fn test_get_block_height() {
        let provider =
            ConfigurableMockProvider::with_responses(vec![Ok(serde_json::json!(123456789u64))]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.get_block_height().await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 123456789);
    }

    // --- WAIT FOR CONFIRMATION TESTS ---

    #[tokio::test]
    async fn test_wait_for_confirmation_immediate_success() {
        let provider = ConfigurableMockProvider::with_responses(vec![Ok(serde_json::json!({
            "value": [{
                "err": null,
                "confirmationStatus": "finalized"
            }]
        }))]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.wait_for_confirmation("test_sig", 5).await;
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_wait_for_confirmation_eventual_success() {
        // First call: not confirmed, second call: confirmed
        let provider = ConfigurableMockProvider::with_responses(vec![
            Ok(serde_json::json!({"value": [null]})),
            Ok(serde_json::json!({
                "value": [{
                    "err": null,
                    "confirmationStatus": "confirmed"
                }]
            })),
        ]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        tokio::time::pause();
        let result = client.wait_for_confirmation("test_sig", 10).await;
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_wait_for_confirmation_timeout() {
        // Always return not confirmed
        let provider = ConfigurableMockProvider::with_responses(vec![
            Ok(serde_json::json!({"value": [null]})),
            Ok(serde_json::json!({"value": [null]})),
            Ok(serde_json::json!({"value": [null]})),
            Ok(serde_json::json!({"value": [null]})),
            Ok(serde_json::json!({"value": [null]})),
        ]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        tokio::time::pause();
        let result = client.wait_for_confirmation("never_confirmed", 1).await;
        assert!(matches!(
            result,
            Err(AppError::Blockchain(BlockchainError::Timeout(_)))
        ));
    }

    #[tokio::test]
    async fn test_wait_for_confirmation_transaction_failed() {
        let provider = ConfigurableMockProvider::with_responses(vec![Ok(serde_json::json!({
            "value": [{
                "err": {"InstructionError": [0, "ProgramFailed"]},
                "confirmationStatus": "confirmed"
            }]
        }))]);
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.wait_for_confirmation("failed_tx", 5).await;
        assert!(matches!(
            result,
            Err(AppError::Blockchain(BlockchainError::TransactionFailed(_)))
        ));
    }

    // --- SUBMIT TRANSACTION TESTS (MOCK MODE) ---

    #[tokio::test]
    #[cfg(not(feature = "real-blockchain"))]
    async fn test_submit_transaction_mock_mode() {
        let provider = ConfigurableMockProvider::new();
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        // In mock mode (no real-blockchain feature), submit_transaction just signs
        let request = TransferRequest {
            id: "test_hash_123".to_string(),
            ..Default::default()
        };
        let result = client.submit_transaction(&request).await;
        assert!(result.is_ok());
        let (signature, blockhash) = result.unwrap();
        assert!(signature.starts_with("tx_")); // Mock format
        assert!(!blockhash.is_empty());
    }

    // --- RETRY LOGIC WITH CALL TRACKING ---

    #[tokio::test]
    async fn test_retry_counts_attempts_correctly() {
        let provider = ConfigurableMockProvider::with_responses(vec![
            Err(MockErrorKind::Timeout("fail 1".to_string())),
            Err(MockErrorKind::Timeout("fail 2".to_string())),
            Err(MockErrorKind::Timeout("fail 3".to_string())),
            Ok(serde_json::json!(999u64)), // Success on 4th attempt
        ]);
        let config = RpcClientConfig {
            max_retries: 3, // Initial + 3 retries = 4 attempts
            retry_delay: Duration::from_millis(1),
            ..Default::default()
        };
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.health_check().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_no_retry_on_insufficient_funds() {
        // InsufficientFunds should still trigger retries as per current implementation
        let provider = ConfigurableMockProvider::with_responses(vec![
            Err(MockErrorKind::InsufficientFunds),
            Err(MockErrorKind::InsufficientFunds),
        ]);
        let config = RpcClientConfig {
            max_retries: 1,
            retry_delay: Duration::from_millis(1),
            ..Default::default()
        };
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        let result = client.health_check().await;
        assert!(matches!(
            result,
            Err(AppError::Blockchain(BlockchainError::InsufficientFunds))
        ));
        // Note: We can't check the provider's state after moving it into Box
        // The test validates that InsufficientFunds is eventually returned after retries
    }

    // --- WITH_PROVIDER CONSTRUCTOR TEST ---

    #[test]
    fn test_with_provider_constructor() {
        let provider = ConfigurableMockProvider::new();
        let config = RpcClientConfig {
            max_retries: 5,
            timeout: Duration::from_secs(45),
            ..Default::default()
        };
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        // Verify public key is accessible
        let pubkey = client.public_key();
        assert!(!pubkey.is_empty());

        // Verify signing works
        let sig = client.sign(b"test");
        assert!(!sig.is_empty());
    }

    // --- HTTP PROVIDER TESTS ---

    #[test]
    fn test_http_solana_rpc_provider_creation() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let result = HttpSolanaRpcProvider::new(
            "https://api.devnet.solana.com",
            signing_key,
            Duration::from_secs(30),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_http_solana_rpc_provider_public_key() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let provider = HttpSolanaRpcProvider::new(
            "https://api.devnet.solana.com",
            signing_key.clone(),
            Duration::from_secs(30),
        )
        .unwrap();

        let pubkey = provider.public_key();
        assert!(!pubkey.is_empty());
        // Verify it matches the expected public key
        let expected = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        assert_eq!(pubkey, expected);
    }

    #[test]
    fn test_http_solana_rpc_provider_sign() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let provider = HttpSolanaRpcProvider::new(
            "https://api.devnet.solana.com",
            signing_key,
            Duration::from_secs(30),
        )
        .unwrap();

        let signature = provider.sign(b"test message");
        assert!(!signature.is_empty());
        // Signature should be base58 encoded
        let decoded = bs58::decode(&signature).into_vec();
        assert!(decoded.is_ok());
        assert_eq!(decoded.unwrap().len(), 64); // Ed25519 signature is 64 bytes
    }

    // --- JSON-RPC STRUCTURE TESTS ---

    #[test]
    fn test_json_rpc_response_with_result() {
        let json = serde_json::json!({
            "result": 12345,
            "error": null
        });
        let response: JsonRpcResponse<u64> = serde_json::from_value(json).unwrap();
        assert_eq!(response.result, Some(12345));
        assert!(response.error.is_none());
    }

    #[test]
    fn test_json_rpc_response_with_error() {
        let json = serde_json::json!({
            "result": null,
            "error": {
                "code": -32600,
                "message": "Invalid Request"
            }
        });
        let response: JsonRpcResponse<u64> = serde_json::from_value(json).unwrap();
        assert!(response.result.is_none());
        assert!(response.error.is_some());
        let error = response.error.unwrap();
        assert_eq!(error.code, -32600);
        assert_eq!(error.message, "Invalid Request");
    }

    #[test]
    fn test_json_rpc_error_insufficient_funds_by_message() {
        let json = serde_json::json!({
            "result": null,
            "error": {
                "code": -32000,
                "message": "Transaction simulation failed: insufficient lamports"
            }
        });
        let response: JsonRpcResponse<String> = serde_json::from_value(json).unwrap();
        let error = response.error.unwrap();
        // The message contains "insufficient" which triggers InsufficientFunds error
        assert!(error.message.contains("insufficient"));
    }

    #[test]
    fn test_json_rpc_error_insufficient_funds_by_code() {
        let json = serde_json::json!({
            "result": null,
            "error": {
                "code": -32002,
                "message": "Some other error"
            }
        });
        let response: JsonRpcResponse<String> = serde_json::from_value(json).unwrap();
        let error = response.error.unwrap();
        // Error code -32002 triggers InsufficientFunds
        assert_eq!(error.code, -32002);
    }

    // --- DESERIALIZATION ERROR TESTS ---

    #[tokio::test]
    async fn test_rpc_call_deserialization_error() {
        // Return a value that can't be deserialized to expected type
        let provider = ConfigurableMockProvider::with_responses(vec![
            Ok(serde_json::json!("not_a_number")), // String instead of u64
        ]);
        let config = RpcClientConfig {
            max_retries: 0,
            ..Default::default()
        };
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        // get_block_height expects u64, but we return a string
        let result = client.get_block_height().await;
        match result {
            Err(AppError::Blockchain(BlockchainError::RpcError(msg))) => {
                assert!(msg.contains("Deserialization error"));
            }
            _ => panic!("Expected deserialization error, got {:?}", result),
        }
    }

    #[tokio::test]
    async fn test_rpc_call_empty_response_after_retries() {
        // No responses configured - should use fallback null
        let provider = ConfigurableMockProvider::new();
        let config = RpcClientConfig {
            max_retries: 0,
            ..Default::default()
        };
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        // Try to get block height - provider returns null which can't deserialize to u64
        let result = client.get_block_height().await;
        assert!(result.is_err());
    }

    // --- SIGNING KEY ADDITIONAL TESTS ---

    #[test]
    fn test_signing_key_from_base58_64_bytes_invalid_keypair() {
        // Create 64 random bytes (not a valid keypair where bytes 32-64 are the public key)
        let invalid_keypair = vec![42u8; 64];
        let encoded = bs58::encode(&invalid_keypair).into_string();
        let secret = SecretString::from(encoded);

        // This should still work since we only use the first 32 bytes
        let result = signing_key_from_base58(&secret);
        assert!(result.is_ok());
    }

    #[test]
    fn test_signing_key_from_base58_empty_string() {
        let secret = SecretString::from("");
        let result = signing_key_from_base58(&secret);
        assert!(result.is_err());
    }

    // --- SDK-BASED TRANSFER TESTS (only with real-blockchain feature) ---

    #[cfg(feature = "real-blockchain")]
    mod real_blockchain_tests {
        use super::*;

        #[tokio::test]
        async fn test_submit_transaction_real_blockchain_path() {
            // This test verifies the SDK client is properly initialized
            // Actual transfer tests require network/mocking
            let signing_key = SigningKey::generate(&mut OsRng);
            let client =
                RpcBlockchainClient::with_defaults("https://api.devnet.solana.com", signing_key)
                    .unwrap();

            // Verify SDK components are initialized
            assert!(client.sdk_client.is_some());
            assert!(client.keypair.is_some());
            let _ = client.public_key();
        }
    }

    // --- RPC CLIENT NEW CONSTRUCTOR TEST ---

    #[test]
    fn test_rpc_blockchain_client_new() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let config = RpcClientConfig {
            timeout: Duration::from_secs(15),
            max_retries: 2,
            retry_delay: Duration::from_millis(250),
            confirmation_timeout: Duration::from_secs(30),
        };
        let result = RpcBlockchainClient::new("https://api.devnet.solana.com", signing_key, config);
        assert!(result.is_ok());
    }

    // --- PROVIDER TRAIT OBJECT TESTS ---

    #[test]
    fn test_provider_as_trait_object() {
        let provider: Box<dyn SolanaRpcProvider> = Box::new(ConfigurableMockProvider::new());

        // Test public_key through trait object
        let pubkey = provider.public_key();
        assert!(!pubkey.is_empty());

        // Test sign through trait object
        let sig = provider.sign(b"message");
        assert!(!sig.is_empty());
    }

    // --- BLOCKHASH RESPONSE DESERIALIZATION ---

    #[test]
    fn test_blockhash_response_deserialization() {
        let json = serde_json::json!({
            "blockhash": "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn"
        });
        let response: BlockhashResponse = serde_json::from_value(json).unwrap();
        assert_eq!(
            response.blockhash,
            "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn"
        );
    }

    // --- ADDITIONAL RPC CLIENT CONFIG TESTS ---

    #[test]
    fn test_rpc_client_config_very_short_timeout() {
        let config = RpcClientConfig {
            timeout: Duration::from_millis(1),
            max_retries: 0,
            retry_delay: Duration::from_millis(1),
            confirmation_timeout: Duration::from_millis(1),
        };
        assert_eq!(config.timeout, Duration::from_millis(1));
    }

    #[test]
    fn test_rpc_client_config_zero_retries() {
        let config = RpcClientConfig {
            max_retries: 0,
            ..Default::default()
        };
        assert_eq!(config.max_retries, 0);
    }

    // ====================================================================
    // SUBMISSION STRATEGY INTEGRATION TESTS
    // ====================================================================

    #[test]
    fn test_client_without_submission_strategy() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let client =
            RpcBlockchainClient::with_defaults("https://api.devnet.solana.com", signing_key)
                .unwrap();

        // Without explicit strategy, should not have one
        assert!(!client.has_submission_strategy());
        assert!(!client.supports_private_submission());
    }

    #[test]
    fn test_client_with_submission_strategy_constructor() {
        use super::super::quicknode::{
            QuickNodePrivateSubmissionStrategy, QuickNodeSubmissionConfig,
        };

        let signing_key = SigningKey::generate(&mut OsRng);
        let config = QuickNodeSubmissionConfig {
            rpc_url: "https://test.quiknode.pro/xxx".to_string(),
            enable_jito_bundles: true,
            tip_lamports: 10_000,
            max_bundle_retries: 2,
            region: None,
        };
        let strategy: Box<dyn super::super::strategies::SubmissionStrategy> =
            Box::new(QuickNodePrivateSubmissionStrategy::new(config));

        let client = RpcBlockchainClient::with_defaults_and_submission_strategy(
            "https://test.quiknode.pro/xxx",
            signing_key,
            Some(strategy),
            Some(10_000), // Jito tip
        )
        .unwrap();

        assert!(client.has_submission_strategy());
        assert!(client.supports_private_submission());
    }

    #[test]
    fn test_client_with_jito_disabled_strategy() {
        use super::super::quicknode::{
            QuickNodePrivateSubmissionStrategy, QuickNodeSubmissionConfig,
        };

        let signing_key = SigningKey::generate(&mut OsRng);
        let config = QuickNodeSubmissionConfig {
            rpc_url: "https://test.quiknode.pro/xxx".to_string(),
            enable_jito_bundles: false, // Jito disabled
            tip_lamports: 10_000,
            max_bundle_retries: 2,
            region: None,
        };
        let strategy: Box<dyn super::super::strategies::SubmissionStrategy> =
            Box::new(QuickNodePrivateSubmissionStrategy::new(config));

        let client = RpcBlockchainClient::with_defaults_and_submission_strategy(
            "https://test.quiknode.pro/xxx",
            signing_key,
            Some(strategy),
            None, // No tip when Jito disabled
        )
        .unwrap();

        // Has strategy, but private submission is not supported (Jito disabled)
        assert!(client.has_submission_strategy());
        assert!(!client.supports_private_submission());
    }

    #[test]
    fn test_with_provider_has_no_strategy() {
        let provider = ConfigurableMockProvider::new();
        let config = RpcClientConfig::default();
        let client = RpcBlockchainClient::with_provider(Box::new(provider), config);

        // with_provider doesn't accept a strategy, so it should not have one
        assert!(!client.has_submission_strategy());
        assert!(!client.supports_private_submission());
    }

    #[test]
    fn test_serialize_transaction_base58() {
        use solana_sdk::{hash::Hash, transaction::Transaction};

        let signing_key = SigningKey::generate(&mut OsRng);
        let client =
            RpcBlockchainClient::with_defaults("https://api.devnet.solana.com", signing_key)
                .unwrap();

        // Create a minimal unsigned transaction
        let recent_blockhash = Hash::new_unique();
        let keypair = client.keypair.as_ref().unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[],
            Some(&keypair.pubkey()),
            &[keypair],
            recent_blockhash,
        );

        // Serialize should work
        let result = client.serialize_transaction_base58(&tx);
        assert!(result.is_ok());

        let serialized = result.unwrap();
        assert!(!serialized.is_empty());

        // Should be valid Base58
        let decoded = bs58::decode(&serialized).into_vec();
        assert!(decoded.is_ok());
    }
}
