//! Database integration tests using testcontainers.
//!
//! These tests require Docker to be running and use testcontainers
//! to spin up a real PostgreSQL instance.

use testcontainers::{GenericImage, ImageExt, runners::AsyncRunner};

use solana_compliance_relayer::domain::{
    BlockchainStatus, ComplianceDecision, ComplianceLevel, DatabaseClient, SubmitTransferRequest,
    TransferType, WalletApprovalStatus,
};
use solana_compliance_relayer::infra::{PostgresClient, PostgresConfig};

fn test_pubkey(seed: u8) -> String {
    bs58::encode([seed; 32]).into_string()
}

fn test_request(seed: u8, amount: u64, nonce: String) -> SubmitTransferRequest {
    SubmitTransferRequest {
        from_address: test_pubkey(seed),
        to_address: test_pubkey(seed.saturating_add(100)),
        transfer_details: TransferType::Public { amount },
        token_mint: Some(test_pubkey(200)),
        signature: "dummy_sig".to_string(),
        nonce,
    }
}

/// Helper to create a PostgreSQL container and client
async fn setup_postgres() -> (PostgresClient, testcontainers::ContainerAsync<GenericImage>) {
    let container = GenericImage::new("postgres", "16-alpine")
        .with_env_var("POSTGRES_DB", "test_db")
        .with_env_var("POSTGRES_USER", "postgres")
        .with_env_var("POSTGRES_PASSWORD", "postgres")
        .start()
        .await
        .expect("Failed to start postgres container");

    let port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("Failed to get postgres port");

    let database_url = format!("postgres://postgres:postgres@127.0.0.1:{}/test_db", port);

    // Wait for postgres to be ready
    let mut attempts = 0;
    let client = loop {
        attempts += 1;
        match PostgresClient::new(&database_url, PostgresConfig::default()).await {
            Ok(client) => break client,
            Err(_) if attempts < 30 => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            Err(e) => panic!("Failed to connect to postgres after 30 attempts: {:?}", e),
        }
    };

    // Run migrations
    client
        .run_migrations()
        .await
        .expect("Failed to run migrations");

    (client, container)
}

#[tokio::test]
async fn test_create_and_get_transfer_request() {
    let (client, _container) = setup_postgres().await;

    let request = test_request(1, 100_000_000_000, "019470a4-7e7c-7d3e-8f1a-2b3c4d5e6001".to_string());

    // Create item
    let created = client
        .submit_transfer(&request)
        .await
        .expect("Failed to submit transfer");
    assert_eq!(created.from_address, test_pubkey(1));
    assert_eq!(created.to_address, test_pubkey(101));
    assert_eq!(
        created.transfer_details,
        TransferType::Public {
            amount: 100_000_000_000
        }
    );
    assert_eq!(created.token_mint, Some(test_pubkey(200)));
    assert!(!created.id.is_empty());

    // Get item
    let fetched = client
        .get_transfer_request(&created.id)
        .await
        .expect("Failed to get request")
        .expect("Request not found");

    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.from_address, created.from_address);
}

#[tokio::test]
async fn test_list_requests_pagination() {
    let (client, _container) = setup_postgres().await;

    // Create 5 items
    for i in 0..5 {
        let request = test_request(
            i as u8,
            (i as u64) * 1_000_000_000,
            format!("019470a4-7e7c-7d3e-8f1a-2b3c4d5e60{:02}", i),
        );
        client
            .submit_transfer(&request)
            .await
            .expect("Failed to submit transfer");
        // Small delay to ensure different timestamps
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    // Get first page (limit 2)
    let page1 = client
        .list_transfer_requests(2, None)
        .await
        .expect("Failed to list requests");
    assert_eq!(page1.items.len(), 2);
    assert!(page1.has_more);
    assert!(page1.next_cursor.is_some());

    // Get second page
    let page2 = client
        .list_transfer_requests(2, page1.next_cursor.as_deref())
        .await
        .expect("Failed to list requests");
    assert_eq!(page2.items.len(), 2);
    assert!(page2.has_more);

    // Get third page
    let page3 = client
        .list_transfer_requests(2, page2.next_cursor.as_deref())
        .await
        .expect("Failed to list requests");
    assert_eq!(page3.items.len(), 1);
    assert!(!page3.has_more);
    assert!(page3.next_cursor.is_none());
}

#[tokio::test]
async fn test_blockchain_status_updates() {
    let (client, _container) = setup_postgres().await;

    let request = test_request(10, 1_000_000_000, "019470a4-7e7c-7d3e-8f1a-2b3c4d5e6100".to_string());
    let created = client
        .submit_transfer(&request)
        .await
        .expect("Failed to submit transfer");
    assert_eq!(created.blockchain_status, BlockchainStatus::Received);

    // Update to pending submission
    client
        .update_blockchain_status(
            &created.id,
            BlockchainStatus::PendingSubmission,
            None,
            Some("Initial error"),
            Some(chrono::Utc::now()),
            None,
        )
        .await
        .expect("Failed to update status");

    let fetched = client
        .get_transfer_request(&created.id)
        .await
        .expect("Failed to get request")
        .expect("Request not found");
    assert_eq!(
        fetched.blockchain_status,
        BlockchainStatus::PendingSubmission
    );
    assert_eq!(
        fetched.blockchain_last_error,
        Some("Initial error".to_string())
    );

    // Update to submitted
    client
        .update_blockchain_status(
            &created.id,
            BlockchainStatus::Submitted,
            Some("signature123"),
            None,
            None,
            None,
        )
        .await
        .expect("Failed to update status");

    let fetched = client
        .get_transfer_request(&created.id)
        .await
        .expect("Failed to get request")
        .expect("Request not found");
    assert_eq!(fetched.blockchain_status, BlockchainStatus::Submitted);
    assert_eq!(
        fetched.blockchain_signature,
        Some("signature123".to_string())
    );
}

#[tokio::test]
async fn test_get_pending_blockchain_requests() {
    let (client, _container) = setup_postgres().await;
    let approved_decision = ComplianceDecision::approved(
        ComplianceLevel::Standard,
        Some(2),
        Some("Low risk".to_string()),
        Some("Screened by Range".to_string()),
    );

    // Create items with different statuses
    for i in 0..3 {
        let request = test_request(
            (20 + i) as u8,
            1_000_000_000,
            format!("019470a4-7e7c-7d3e-8f1a-2b3c4d5e62{:02}", i),
        );
        let item = client
            .submit_transfer(&request)
            .await
            .expect("Failed to submit transfer");

        if i == 0 {
            // Leave as pending
        } else if i == 1 {
            // Queue an approved wallet approval and then make the transfer relayable.
            let approval = client
                .enqueue_wallet_approval_if_missing(
                    request.token_mint.as_deref().unwrap(),
                    &item.to_address,
                    &approved_decision,
                )
                .await
                .expect("Failed to enqueue wallet approval");
            client
                .mark_transfer_approved(&item.id, &approved_decision, &approval)
                .await
                .expect("Failed to mark transfer approved");
            client
                .update_wallet_approval_status(
                    &approval.id,
                    WalletApprovalStatus::Approved,
                    Some("approval_sig_123"),
                    None,
                    None,
                    Some(chrono::Utc::now()),
                )
                .await
                .expect("Failed to update wallet approval status");
            client
                .enqueue_transfer_submission(&item.id)
                .await
                .expect("Failed to enqueue transfer submission");
        } else {
            client
                .update_blockchain_status(
                    &item.id,
                    BlockchainStatus::Confirmed,
                    Some("sig"),
                    None,
                    None,
                    None,
                )
                .await
                .expect("Failed to update status");
        }
    }

    let pending = client
        .get_pending_blockchain_requests(10)
        .await
        .expect("Failed to get pending requests");

    // Only the item with pending_submission status should be returned
    // NOTE: The atomic claim logic updates status to Processing when fetching
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].blockchain_status, BlockchainStatus::Processing);
}

#[tokio::test]
async fn test_increment_retry_count() {
    let (client, _container) = setup_postgres().await;

    let request = test_request(30, 1_000_000_000, "019470a4-7e7c-7d3e-8f1a-2b3c4d5e6300".to_string());
    let created = client
        .submit_transfer(&request)
        .await
        .expect("Failed to submit transfer");
    assert_eq!(created.blockchain_retry_count, 0);

    // Increment retry count
    let count1 = client
        .increment_retry_count(&created.id)
        .await
        .expect("Failed to increment");
    assert_eq!(count1, 1);

    let count2 = client
        .increment_retry_count(&created.id)
        .await
        .expect("Failed to increment");
    assert_eq!(count2, 2);

    // Verify in database
    let fetched = client
        .get_transfer_request(&created.id)
        .await
        .expect("Failed to get request")
        .expect("Request not found");
    assert_eq!(fetched.blockchain_retry_count, 2);
}

#[tokio::test]
async fn test_wallet_approval_enqueue_is_idempotent() {
    let (client, _container) = setup_postgres().await;
    let decision = ComplianceDecision::approved(
        ComplianceLevel::Basic,
        Some(1),
        Some("Very low risk".to_string()),
        Some("First approval".to_string()),
    );
    let wallet_address = test_pubkey(77);
    let token_mint = test_pubkey(200);

    let first = client
        .enqueue_wallet_approval_if_missing(&token_mint, &wallet_address, &decision)
        .await
        .expect("Failed to enqueue first approval");
    let second = client
        .enqueue_wallet_approval_if_missing(&token_mint, &wallet_address, &decision)
        .await
        .expect("Failed to enqueue second approval");

    assert_eq!(first.wallet_address, second.wallet_address);
    assert_eq!(first.token_mint, second.token_mint);
    assert_eq!(first.compliance_record_pda, second.compliance_record_pda);
}

#[tokio::test]
async fn test_health_check() {
    let (client, _container) = setup_postgres().await;

    let result = client.health_check().await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_get_nonexistent_request() {
    let (client, _container) = setup_postgres().await;

    let result = client
        .get_transfer_request("nonexistent_id")
        .await
        .expect("Query should succeed");
    assert!(result.is_none());
}
