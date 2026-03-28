// =============================================================================
// RWA Tokenizer — Standalone Mint Initialization Script
// =============================================================================
//
// Скрипт для создания Token-2022 Mint с Transfer Hook extension на Devnet.
//
// Использование:
//   npx ts-node scripts/initialize-mint.ts
//
// Переменные окружения:
//   ANCHOR_PROVIDER_URL — RPC endpoint (default: https://api.devnet.solana.com)
//   ANCHOR_WALLET       — путь к keypair (default: ~/.config/solana/id.json)
//
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { RwaTokenizer } from "../target/types/rwa_tokenizer";

async function main() {
  // ===========================================================================
  // 1. Provider Setup
  // ===========================================================================

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RwaTokenizer as Program<RwaTokenizer>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║       RWA Tokenizer — Mint Initialization Script        ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║ Cluster:  ${provider.connection.rpcEndpoint}`);
  console.log(`║ Wallet:   ${wallet.publicKey.toBase58()}`);
  console.log(`║ Program:  ${program.programId.toBase58()}`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  // ===========================================================================
  // 2. Создание Token-2022 Mint с Transfer Hook Extension
  // ===========================================================================

  const mint = Keypair.generate();
  const decimals = 0;

  console.log("\n[1/3] Creating Token-2022 Mint with Transfer Hook...");

  const extensions = [ExtensionType.TransferHook];
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    // Allocate account
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // Initialize Transfer Hook extension
    // Привязываем наш rwa_tokenizer program как hook
    createInitializeTransferHookInstruction(
      mint.publicKey,
      wallet.publicKey, // authority, может обновить hook program
      program.programId, // наш hook program
      TOKEN_2022_PROGRAM_ID
    ),
    // Initialize Mint
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      wallet.publicKey, // mint authority
      null, // freeze authority
      TOKEN_2022_PROGRAM_ID
    )
  );

  const mintTxSig = await sendAndConfirmTransaction(
    connection,
    createMintTx,
    [wallet.payer, mint]
  );

  console.log(`  ✓ Mint:     ${mint.publicKey.toBase58()}`);
  console.log(`  ✓ Decimals: ${decimals}`);
  console.log(`  ✓ Hook:     ${program.programId.toBase58()}`);
  console.log(`  ✓ Tx:       ${mintTxSig}`);

  // ===========================================================================
  // 3. Инициализация ExtraAccountMetaList PDA
  // ===========================================================================

  console.log("\n[2/3] Initializing ExtraAccountMetaList PDA...");

  const [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    program.programId
  );

  const initMetasTx = await program.methods
    .initializeExtraAccountMetaList()
    .accounts({
      payer: wallet.publicKey,
      mint: mint.publicKey,
    })
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  console.log(`  ✓ PDA:  ${extraAccountMetaListPDA.toBase58()}`);
  console.log(`  ✓ Tx:   ${initMetasTx}`);

  // ===========================================================================
  // 4. Создание Asset Record
  // ===========================================================================

  console.log("\n[3/3] Creating Asset Record...");

  const [assetRecordPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), mint.publicKey.toBuffer()],
    program.programId
  );

  const assetName = "SPV: Luxury Villa, Almaty";
  const plannedSupply = new anchor.BN(1);
  const documentUri = "ipfs://QmExampleCID123456789";
  const documentHash = Array.from(Buffer.alloc(32, 0xab)); // Placeholder hash

  const assetTx = await program.methods
    .initializeAsset(
      assetName,
      { realEstate: {} },
      plannedSupply,
      new anchor.BN(2_000_000_00),
      documentUri,
      documentHash
    )
    .accounts({
      authority: wallet.publicKey,
      mint: mint.publicKey,
    })
    .rpc();

  console.log(`  ✓ Asset: "${assetName}"`);
  console.log(`  ✓ PDA:   ${assetRecordPDA.toBase58()}`);
  console.log(`  ✓ Tx:    ${assetTx}`);

  // ===========================================================================
  // Summary
  // ===========================================================================

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                   DEPLOYMENT COMPLETE                    ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║ Mint:                ${mint.publicKey.toBase58()}`);
  console.log(`║ ExtraAccountMetas:   ${extraAccountMetaListPDA.toBase58()}`);
  console.log(`║ AssetRecord:         ${assetRecordPDA.toBase58()}`);
  console.log(`║ Hook Program:        ${program.programId.toBase58()}`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║ Next steps:                                              ║");
  console.log("║   1. Call approve_wallet() for each KYC'd address        ║");
  console.log("║   2. Mint tokens to approved wallets                     ║");
  console.log("║   3. Transfers will be automatically compliance-checked  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // Save mint address for other scripts
  const fs = require("fs");
  const deployInfo = {
    mint: mint.publicKey.toBase58(),
    programId: program.programId.toBase58(),
    extraAccountMetaList: extraAccountMetaListPDA.toBase58(),
    assetRecord: assetRecordPDA.toBase58(),
    plannedSupply: plannedSupply.toString(),
    decimals,
    network: provider.connection.rpcEndpoint,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deploy-info.json",
    JSON.stringify(deployInfo, null, 2)
  );
  console.log("\n  Deploy info saved to deploy-info.json");
}

main().catch(console.error);
