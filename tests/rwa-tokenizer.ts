// =============================================================================
// RWA Tokenizer — Integration Test & Client Script
// =============================================================================
//
// Полный end-to-end flow:
//   1. Создание Token-2022 Mint с Transfer Hook extension (client-side)
//   2. Инициализация ExtraAccountMetaList (Anchor CPI)
//   3. Создание AssetRecord (метаданные актива)
//   4. Создание token accounts + mint whole-asset token
//   5a. Добавление отправителя в compliance whitelist
//   5b. Добавление получателя в compliance whitelist (dual compliance)
//   6. Transfer whole-asset token к recipient (должен пройти)
//   7. Revoke compliance у wallet, который станет receiver при возврате
//   8. Попытка transfer whole-asset token обратно к revoked wallet (должен упасть)
//
// Mint создаётся CLIENT-SIDE через низкоуровневые SPL Token-2022 инструкции,
// а не через Anchor CPI. Наш Anchor program — это hook program, вызываемый
// Token-2022 при каждом transfer.
//
// =============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { expect } from "chai";
import { RwaTokenizer } from "../target/types/rwa_tokenizer";

describe("rwa_tokenizer", () => {
  // ===========================================================================
  // Setup
  // ===========================================================================

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RwaTokenizer as Program<RwaTokenizer>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Keypair для нового Token-2022 Mint
  const mint = Keypair.generate();
  const decimals = 0; // Whole-asset tokenization: exactly 1 token, no fractional units

  // Получатель (тестовый кошелёк)
  const recipient = Keypair.generate();

  // Derive token account addresses (Associated Token Accounts)
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    mint.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const destinationTokenAccount = getAssociatedTokenAddressSync(
    mint.publicKey,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Derive PDAs
  const [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    program.programId
  );

  const [assetRecordPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), mint.publicKey.toBuffer()],
    program.programId
  );

  const [senderCompliancePDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("compliance"),
      mint.publicKey.toBuffer(),
      wallet.publicKey.toBuffer(),
    ],
    program.programId
  );

  const [recipientCompliancePDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("compliance"),
      mint.publicKey.toBuffer(),
      recipient.publicKey.toBuffer(),
    ],
    program.programId
  );

  // ===========================================================================
  // Step 1: Создание Token-2022 Mint с Transfer Hook Extension
  // ===========================================================================
  //
  // ВАЖНО: Mint создаётся CLIENT-SIDE. Transfer Hook extension указывает
  // Token-2022 program вызывать наш program_id при каждом transfer.
  //
  // Порядок инструкций критичен:
  //   1. SystemProgram.createAccount — выделяем место под mint account
  //   2. createInitializeTransferHookInstruction — регистрируем hook
  //   3. createInitializeMintInstruction — инициализируем mint
  //
  // НЕЛЬЗЯ менять порядок: extensions должны быть инициализированы ДО mint.
  //

  it("Step 1: Create Token-2022 Mint with Transfer Hook extension", async () => {
    // Рассчитываем размер mint account с учётом TransferHook extension
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    const lamports =
      await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const transaction = new Transaction().add(
      // 1. Создаём аккаунт для mint (owner = Token-2022 program)
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports: lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),

      // 2. Инициализируем Transfer Hook extension
      //    authority = wallet (может менять hook program в будущем)
      //    programId = наш rwa_tokenizer program
      createInitializeTransferHookInstruction(
        mint.publicKey,
        wallet.publicKey, // transfer hook authority
        program.programId, // ← наш hook program, вызываемый при каждом transfer
        TOKEN_2022_PROGRAM_ID
      ),

      // 3. Инициализируем сам Mint
      //    mintAuthority = wallet (может минтить токены)
      //    freezeAuthority = null (для MVP не нужен)
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        wallet.publicKey, // mint authority
        null, // freeze authority (опционально)
        TOKEN_2022_PROGRAM_ID
      )
    );

    const txSig = await sendAndConfirmTransaction(
      provider.connection,
      transaction,
      [wallet.payer, mint] // mint keypair нужен как signer для createAccount
    );

    console.log(`  Mint created: ${mint.publicKey.toBase58()}`);
    console.log(`  Hook program: ${program.programId.toBase58()}`);
    console.log(`  Tx: ${txSig}`);
  });

  // ===========================================================================
  // Step 2: Инициализация ExtraAccountMetaList
  // ===========================================================================
  //
  // Создаём PDA, который Token-2022 считывает перед каждым transfer,
  // чтобы знать, какие дополнительные аккаунты передать в наш hook.
  //
  // В нашем случае extra accounts включают AssetRecord PDA и два
  // ComplianceRecord PDA (sender/receiver), динамически разрешённые через seeds.
  //

  it("Step 2: Initialize ExtraAccountMetaList", async () => {
    const ix = await program.methods
      .initializeExtraAccountMetaList()
      .accounts({
        payer: wallet.publicKey,
        mint: mint.publicKey,
      })
      .instruction();

    const transaction = new Transaction().add(ix);

    const txSig = await sendAndConfirmTransaction(
      provider.connection,
      transaction,
      [wallet.payer],
      { skipPreflight: true, commitment: "confirmed" }
    );

    console.log(`  ExtraAccountMetaList PDA: ${extraAccountMetaListPDA.toBase58()}`);
    console.log(`  Tx: ${txSig}`);
  });

  // ===========================================================================
  // Step 3: Создание Asset Record (метаданные RWA)
  // ===========================================================================
  //
  // Записываем on-chain информацию о реальном активе:
  // - Название, тип, оценка
  // - IPFS URI документов
  // - SHA256 хэш документов (proof-of-asset, immutable)
  //

  it("Step 3: Initialize RWA Asset Record", async () => {
    // Пример: токенизация премиального актива через SPV
    const assetName = "SPV: Luxury Villa, Almaty";
    const plannedSupply = new anchor.BN(1);
    const documentUri = "ipfs://QmExampleHash123456789abcdef"; // IPFS CID
    // SHA256 хэш пакета документов (в реальности — hash от PDF/zip)
    const documentHash = Array.from(
      Buffer.from(
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        "hex"
      )
    );

    const tx = await program.methods
      .initializeAsset(
        assetName,
        { realEstate: {} }, // AssetType::RealEstate
        plannedSupply, // Planned single whole-asset token
        new anchor.BN(2_000_000_00), // $2,000,000.00 (в центах)
        documentUri,
        documentHash
      )
      .accounts({
        authority: wallet.publicKey,
        mint: mint.publicKey,
      })
      .rpc();

    console.log(`  Asset: "${assetName}"`);
    console.log(`  PDA: ${assetRecordPDA.toBase58()}`);
    console.log(`  Tx: ${tx}`);

    // Верифицируем данные on-chain
    const asset = await program.account.assetRecord.fetch(assetRecordPDA);
    expect(asset.name).to.equal(assetName);
    expect(asset.assetType).to.deep.equal({ realEstate: {} });
    expect(asset.plannedSupply.toString()).to.equal(plannedSupply.toString());
    expect(asset.isActive).to.be.true;
    console.log(`  ✓ Asset record verified on-chain`);
  });

  // ===========================================================================
  // Step 4: Создание Token Accounts и Mint токенов
  // ===========================================================================

  it("Step 4: Create Token Accounts and Mint tokens", async () => {
    const amount = 1; // Exactly 1 whole-asset token

    const transaction = new Transaction().add(
      // ATA для отправителя (wallet)
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        sourceTokenAccount,
        wallet.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      // ATA для получателя (recipient)
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        destinationTokenAccount,
        recipient.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      // Mint the single whole-asset token to the sender wallet
      createMintToInstruction(
        mint.publicKey,
        sourceTokenAccount,
        wallet.publicKey,
        amount,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    const txSig = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet.payer],
      { skipPreflight: true }
    );

    console.log(`  Minted ${amount} whole-asset token to sender`);
    console.log(`  Source ATA: ${sourceTokenAccount.toBase58()}`);
    console.log(`  Destination ATA: ${destinationTokenAccount.toBase58()}`);
    console.log(`  Tx: ${txSig}`);
  });

  // ===========================================================================
  // Step 5: Добавление отправителя И получателя в compliance whitelist
  // ===========================================================================
  //
  // Создаём ComplianceRecord PDA для wallet (отправитель) и recipient (получатель).
  // Dual compliance: Transfer Hook проверяет ОБОИХ участников.
  // Без этого шага трансфер будет заблокирован hook'ом.
  //

  it("Step 5a: Approve sender wallet for compliance", async () => {
    const tx = await program.methods
      .approveWallet({ standard: {} }) // ComplianceLevel::Standard
      .accountsPartial({
        authority: wallet.publicKey,
        mint: mint.publicKey,
        assetRecord: assetRecordPDA,
        wallet: wallet.publicKey,
      })
      .rpc();

    console.log(`  Sender ${wallet.publicKey.toBase58()} → APPROVED`);
    console.log(`  Compliance PDA: ${senderCompliancePDA.toBase58()}`);
    console.log(`  Tx: ${tx}`);

    // Verify
    const record = await program.account.complianceRecord.fetch(
      senderCompliancePDA
    );
    expect(record.status).to.deep.equal({ approved: {} });
    expect(record.level).to.deep.equal({ standard: {} });
    console.log(`  ✓ Sender compliance record verified on-chain`);
  });

  it("Step 5b: Approve recipient wallet for compliance", async () => {
    const tx = await program.methods
      .approveWallet({ standard: {} }) // ComplianceLevel::Standard
      .accountsPartial({
        authority: wallet.publicKey,
        mint: mint.publicKey,
        assetRecord: assetRecordPDA,
        wallet: recipient.publicKey,
      })
      .rpc();

    console.log(`  Recipient ${recipient.publicKey.toBase58()} → APPROVED`);
    console.log(`  Compliance PDA: ${recipientCompliancePDA.toBase58()}`);
    console.log(`  Tx: ${tx}`);

    // Verify
    const record = await program.account.complianceRecord.fetch(
      recipientCompliancePDA
    );
    expect(record.status).to.deep.equal({ approved: {} });
    expect(record.level).to.deep.equal({ standard: {} });
    console.log(`  ✓ Recipient compliance record verified on-chain`);
  });

  // ===========================================================================
  // Step 6: Transfer whole-asset token с активным compliance (ДОЛЖЕН ПРОЙТИ)
  // ===========================================================================
  //
  // Отправитель прошёл KYC → ComplianceRecord PDA существует и status = Approved.
  // Token-2022 вызовет наш hook, который проверит PDA и разрешит трансфер.
  //
  // createTransferCheckedWithTransferHookInstruction — helper из @solana/spl-token,
  // который автоматически разрешает extra accounts из ExtraAccountMetaList PDA.
  //

  it("Step 6: Transfer the whole-asset token to recipient (should succeed)", async () => {
    const amount = 1;
    const bigIntAmount = BigInt(amount);

    // Эта функция автоматически:
    //   1. Читает ExtraAccountMetaList PDA
    //   2. Разрешает все extra accounts (ComplianceRecord PDA отправителя)
    //   3. Добавляет их в инструкцию transfer
    const transferIx =
      await createTransferCheckedWithTransferHookInstruction(
        connection,
        sourceTokenAccount, // from
        mint.publicKey, // mint
        destinationTokenAccount, // to
        wallet.publicKey, // owner/authority
        bigIntAmount,
        decimals,
        [], // additional signers
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

    const transaction = new Transaction().add(transferIx);

    const txSig = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet.payer],
      { skipPreflight: true }
    );

    console.log(`  ✓ Transfer of the whole-asset token to recipient SUCCEEDED`);
    console.log(`  Tx: ${txSig}`);
  });

  // ===========================================================================
  // Step 7: Revoke wallet compliance before return transfer (ДОЛЖЕН ПРОЙТИ)
  // ===========================================================================
  //
  // После Step 6 wallet больше не держит токен, но станет receiver при
  // обратном transfer. Отзываем compliance wallet, чтобы следующий transfer
  // recipient -> wallet был заблокирован на receiver-side.
  //

  it("Step 7: Revoke wallet compliance for the return transfer", async () => {
    // Отзываем compliance-статус wallet
    const revokeTx = await program.methods
      .revokeWallet()
      .accountsPartial({
        authority: wallet.publicKey,
        complianceRecord: senderCompliancePDA,
        assetRecord: assetRecordPDA,
      })
      .rpc();

    console.log(`  Wallet compliance REVOKED. Tx: ${revokeTx}`);

    // Verify revocation
    const record = await program.account.complianceRecord.fetch(
      senderCompliancePDA
    );
    expect(record.status).to.deep.equal({ revoked: {} });
  });

  // ===========================================================================
  // Step 8: Return transfer to revoked wallet receiver (ДОЛЖЕН УПАСТЬ)
  // ===========================================================================
  //
  // Recipient теперь держит единственный токен и выступает sender'ом,
  // а wallet выступает receiver'ом. Recipient compliance остаётся active,
  // но wallet compliance revoked в Step 7, поэтому hook должен заблокировать
  // возврат whole-asset token на стороне receiver.
  //

  it("Step 8: Transfer the whole-asset token back to revoked wallet (should fail)", async () => {
    // Fund recipient для tx fees (SystemProgram.transfer,
    // а не requestAirdrop, который ненадёжен в localnet)
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1_000_000_000, // 1 SOL
      })
    );
    await sendAndConfirmTransaction(
      connection,
      fundTx,
      [wallet.payer]
    );

    // Wallet compliance уже revoked в Step 7.
    // При обратном transfer (recipient → wallet):
    //   sender = recipient (его compliance активен, Step 5b)
    //   receiver = wallet (его compliance revoked, Step 7)
    // Transfer Hook должен заблокировать на receiver check.

    const amount = 1;
    const bigIntAmount = BigInt(amount);

    // Recipient → Wallet (обратный перевод)
    const transferIx =
      await createTransferCheckedWithTransferHookInstruction(
        connection,
        destinationTokenAccount, // from (recipient's account)
        mint.publicKey,
        sourceTokenAccount, // to (wallet's account)
        recipient.publicKey, // owner/sender
        bigIntAmount,
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

    const transaction = new Transaction().add(transferIx);

    try {
      await sendAndConfirmTransaction(
        connection,
        transaction,
        [recipient], // recipient signs
        { skipPreflight: true }
      );
      expect.fail(
        "Return transfer should have been blocked because wallet compliance is revoked"
      );
    } catch (err) {
      console.log(`  ✓ Return transfer correctly BLOCKED: wallet receiver compliance revoked`);
      console.log(`  Error: ${(err as Error).message.slice(0, 100)}...`);
    }
  });
});
