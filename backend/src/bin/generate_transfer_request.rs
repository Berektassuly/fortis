//! CLI utility to generate a signed public Token-2022 transfer request.
//!
//! Usage:
//!   cargo run --bin generate_transfer_request
//!   cargo run --bin generate_transfer_request -- --mint <MINT> --to <WALLET> --amount <RAW_UNITS>

use ed25519_dalek::{Signer, SigningKey};
use fortis_rwa_backend::domain::types::SubmitTransferRequest;
use solana_sdk::pubkey::Pubkey;

const DEFAULT_PRIVATE_KEY_B58: &str =
    "3UNZciMppCp3btFvxwAWfhN1dp99YUYrxDS7F9Gf4mYumUkeYENZMXdmfJRe2zofqvLkvabb9YkbiusuS7uKJbxu";
const DEFAULT_API_URL: &str = "http://localhost:3000/transfer-requests";
const DEFAULT_AMOUNT: u64 = 1_000_000_000;

#[derive(Debug)]
struct Options {
    api_url: String,
    amount: u64,
    token_mint: String,
    to_address: String,
    private_key_b58: String,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            api_url: DEFAULT_API_URL.to_string(),
            amount: DEFAULT_AMOUNT,
            token_mint: Pubkey::new_unique().to_string(),
            to_address: Pubkey::new_unique().to_string(),
            private_key_b58: DEFAULT_PRIVATE_KEY_B58.to_string(),
        }
    }
}

fn main() {
    let options = parse_args(std::env::args().skip(1)).unwrap_or_else(|message| {
        eprintln!("{message}");
        std::process::exit(1);
    });

    let key_bytes = bs58::decode(&options.private_key_b58)
        .into_vec()
        .expect("private key must be valid base58");
    let signing_key =
        SigningKey::from_bytes(key_bytes[..32].try_into().expect("key must be 32 bytes"));
    let from_pubkey = Pubkey::from(signing_key.verifying_key().to_bytes());
    let nonce = uuid::Uuid::now_v7().to_string();
    let message = format!(
        "{}:{}:{}:{}:{}",
        from_pubkey, options.to_address, options.amount, options.token_mint, nonce
    );
    let signature = signing_key.sign(message.as_bytes());
    let signature_bs58 = bs58::encode(signature.to_bytes()).into_string();
    let request = SubmitTransferRequest::new(
        from_pubkey.to_string(),
        options.to_address.clone(),
        options.amount,
        options.token_mint.clone(),
        signature_bs58,
        nonce.clone(),
    );
    let json_body = serde_json::to_string_pretty(&request).expect("request should serialize");
    let curl_cmd = format!(
        "curl -X POST '{}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: {}' \\\n  -d '{}'",
        options.api_url, nonce, json_body
    );

    println!("from_address: {}", from_pubkey);
    println!("to_address: {}", options.to_address);
    println!("token_mint: {}", options.token_mint);
    println!("amount: {}", options.amount);
    println!("nonce: {}", nonce);
    println!("signing_message: {}", message);
    println!("\n{}", curl_cmd);
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut options = Options::default();
    let mut iter = args.peekable();

    while let Some(arg) = iter.next() {
        let value = match arg.as_str() {
            "--mint" | "--to" | "--amount" | "--private-key" | "--url" => iter
                .next()
                .ok_or_else(|| format!("Missing value for {arg}\n\n{}", usage()))?,
            "--help" | "-h" => return Err(usage()),
            other => return Err(format!("Unknown argument: {other}\n\n{}", usage())),
        };

        match arg.as_str() {
            "--mint" => options.token_mint = value,
            "--to" => options.to_address = value,
            "--amount" => {
                options.amount = value
                    .parse::<u64>()
                    .map_err(|_| format!("Invalid amount: {value}\n\n{}", usage()))?;
            }
            "--private-key" => options.private_key_b58 = value,
            "--url" => options.api_url = value,
            _ => unreachable!(),
        }
    }

    Ok(options)
}

fn usage() -> String {
    "Usage: cargo run --bin generate_transfer_request -- [--mint <MINT>] [--to <WALLET>] [--amount <RAW_UNITS>] [--private-key <BASE58>] [--url <URL>]".to_string()
}
