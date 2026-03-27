// =============================================================================
// RWA Tokenizer — Compliant Transfer Hook Program
// =============================================================================
//
// Программа реализует on-chain compliance enforcement для токенизированных
// реальных активов (RWA) через механизм Transfer Hook (Token-2022).
//
// Архитектура:
//   1. Authority создаёт AssetRecord (PDA) — метаданные актива (тип, оценка,
//      URI документов, IPFS hash).
//   2. Authority добавляет кошельки в compliance whitelist — per-wallet PDA
//      ComplianceRecord, привязанный к mint + wallet.
//   3. При КАЖДОМ token transfer Token-2022 program вызывает наш hook через CPI.
//      Hook проверяет ComplianceRecord и отправителя, и получателя.
//      Если любой PDA не существует или status != Approved — транзакция отклоняется.
//
// Ключевые решения:
//   - Per-wallet PDA вместо Vec<Pubkey> в одном аккаунте: O(1) lookup вместо
//     O(n), нет лимита на количество кошельков, нет realloc.
//   - ExtraAccountMetaList использует Seed::AccountKey для динамического
//     разрешения compliance PDA из owner wallet (index 3 в execute).
//   - create_account CPI для ExtraAccountMetaList с динамическим size_of()
//     вместо Anchor init с захардкоженным space.
//   - Fallback function для маршрутизации SPL interface discriminator.
//
// Версии:
//   anchor-lang         = 0.31.1
//   anchor-spl          = 0.31.1 (features: token_2022, token_2022_extensions)
//   spl-transfer-hook-interface = 0.10.0
//   spl-tlv-account-resolution  = 0.10.0
//
// =============================================================================

use anchor_lang::{
    prelude::*,
    solana_program::program_option::COption,
    system_program::{create_account, CreateAccount},
};
use anchor_spl::token_interface::{Mint, TokenAccount};
// Re-export spl_token_2022 через anchor_spl, чтобы избежать конфликта версий.
// anchor-spl 0.31.1 подтягивает совместимую версию spl-token-2022.
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_2022::spl_token_2022::extension::BaseStateWithExtensions;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};

declare_id!("8oiLUNoBU3CrpuR8HhRTCawWfDog8WbYkcX1PkqmGvpk");

// =============================================================================
// Constants
// =============================================================================

/// Максимальная длина URI (IPFS hash или URL документов подтверждения актива).
const MAX_URI_LEN: usize = 200;

/// Максимальная длина имени актива.
const MAX_NAME_LEN: usize = 64;

// =============================================================================
// Program
// =============================================================================

#[program]
pub mod rwa_tokenizer {
    use super::*;

    // =========================================================================
    // Инструкция 1: Создание записи об активе (Asset Record)
    // =========================================================================
    //
    // Authority вызывает эту инструкцию один раз для каждого токенизируемого
    // актива. Создаётся PDA AssetRecord с метаданными: название, тип актива,
    // оценка, URI документов, SHA256-хэш документов (proof-of-asset).
    //
    // PDA seeds: ["asset", mint.key()]
    //
    pub fn initialize_asset(
        ctx: Context<InitializeAsset>,
        name: String,
        asset_type: AssetType,
        planned_supply: u64,
        valuation_usd: u64,
        document_uri: String,
        document_hash: [u8; 32],
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, RwaError::NameTooLong);
        require!(document_uri.len() <= MAX_URI_LEN, RwaError::UriTooLong);
        require!(planned_supply > 0, RwaError::InvalidSupply);
        require!(valuation_usd > 0, RwaError::InvalidValuation);

        let asset = &mut ctx.accounts.asset_record;
        asset.authority = ctx.accounts.authority.key();
        asset.mint = ctx.accounts.mint.key();
        asset.name = name;
        asset.asset_type = asset_type;
        asset.planned_supply = planned_supply;
        asset.valuation_usd = valuation_usd;
        asset.document_uri = document_uri;
        asset.document_hash = document_hash;
        asset.created_at = Clock::get()?.unix_timestamp;
        asset.is_active = true;
        asset.bump = ctx.bumps.asset_record;

        msg!(
            "RWA Asset initialized: mint={}, type={:?}, valuation=${}",
            asset.mint,
            asset.asset_type,
            asset.valuation_usd
        );
        Ok(())
    }

    // =========================================================================
    // Инструкция 2: Обновление оценки актива
    // =========================================================================
    //
    // Только authority может обновить оценку. В продакшене это может быть
    // oracle (Switchboard/Pyth) или off-chain attestation service.
    //
    pub fn update_asset_valuation(ctx: Context<UpdateAsset>, new_valuation_usd: u64) -> Result<()> {
        require!(new_valuation_usd > 0, RwaError::InvalidValuation);

        let asset = &mut ctx.accounts.asset_record;
        let old_valuation = asset.valuation_usd;
        asset.valuation_usd = new_valuation_usd;

        msg!(
            "Asset valuation updated: {} -> {} USD (mint={})",
            old_valuation,
            new_valuation_usd,
            asset.mint
        );
        Ok(())
    }

    // =========================================================================
    // Инструкция 3: Добавление кошелька в compliance whitelist
    // =========================================================================
    //
    // Authority создаёт ComplianceRecord PDA для конкретного кошелька.
    // PDA seeds: ["compliance", mint.key(), wallet.key()]
    //
    // Этот PDA будет динамически разрешён Transfer Hook'ом при каждом трансфере.
    // Если PDA не существует — трансфер блокируется.
    //
    pub fn approve_wallet(
        ctx: Context<ApproveWallet>,
        compliance_level: ComplianceLevel,
    ) -> Result<()> {
        let record = &mut ctx.accounts.compliance_record;
        record.mint = ctx.accounts.mint.key();
        record.wallet = ctx.accounts.wallet.key();
        record.authority = ctx.accounts.asset_record.authority;
        record.status = ComplianceStatus::Approved;
        record.level = compliance_level;
        record.approved_at = Clock::get()?.unix_timestamp;
        record.expires_at = 0; // 0 = no expiration; в продакшене можно задавать TTL
        record.bump = ctx.bumps.compliance_record;

        msg!(
            "Wallet {} approved for mint {} (level={:?})",
            record.wallet,
            record.mint,
            record.level
        );
        Ok(())
    }

    // =========================================================================
    // Инструкция 4: Отзыв compliance-статуса кошелька
    // =========================================================================
    //
    // Authority может заблокировать кошелёк. После этого все трансферы
    // от этого кошелька будут отклоняться hook'ом.
    //
    pub fn revoke_wallet(ctx: Context<RevokeWallet>) -> Result<()> {
        let record = &mut ctx.accounts.compliance_record;
        record.status = ComplianceStatus::Revoked;

        msg!(
            "Wallet {} compliance REVOKED for mint {}",
            record.wallet,
            record.mint
        );
        Ok(())
    }

    // =========================================================================
    // Инструкция 5: Инициализация ExtraAccountMetaList
    // =========================================================================
    //
    // КРИТИЧЕСКАЯ инструкция. Создаёт PDA-аккаунт, который Token-2022 program
    // считывает перед каждым трансфером, чтобы знать, какие дополнительные
    // аккаунты нужно передать в наш hook.
    //
    // Мы используем create_account CPI (а не Anchor `init`) для динамического
    // расчёта размера через ExtraAccountMetaList::size_of().
    //
    // ExtraAccountMeta конфигурация:
    //   - index 5: AssetRecord PDA
    //     Seeds: ["asset", AccountKey(1)=mint]
    //   - index 6: ComplianceRecord PDA отправителя (sender)
    //     Seeds: ["compliance", AccountKey(1)=mint, AccountKey(3)=owner]
    //   - index 7: ComplianceRecord PDA получателя (receiver)
    //     Seeds: ["compliance", AccountKey(1)=mint, AccountData(2, 32, 32)=dest owner]
    //
    //   Стандартные индексы Transfer Hook execute:
    //     index 0 = source token account
    //     index 1 = mint
    //     index 2 = destination token account
    //     index 3 = owner (authority/delegate of source)
    //     index 4 = ExtraAccountMetaList PDA
    //     index 5+ = наши extra accounts
    //
    //   Для отправителя: owner напрямую доступен как account (index 3).
    //   Для получателя: owner НЕ передаётся как отдельный account —
    //   извлекаем из данных destination token account (index 2)
    //   через AccountData { account_index: 2, data_index: 32, length: 32 }.
    //   SPL Token account layout: [mint: 0..32, owner: 32..64, ...].
    //
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        // Определяем extra accounts, которые Token-2022 должен разрешить
        // и передать в наш transfer_hook при каждом трансфере.
        let account_metas = vec![
            // ---------------------------------------------------------------
            // Extra Account #0 (index 5 в общем списке):
            // AssetRecord PDA.
            // ---------------------------------------------------------------
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"asset".to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint pubkey
                ],
                false, // is_signer
                false, // is_writable (только чтение)
            )
            .map_err(|_| anchor_lang::prelude::ProgramError::InvalidAccountData)?,
            // ---------------------------------------------------------------
            // Extra Account #1 (index 6 в общем списке):
            // ComplianceRecord PDA SENDER (отправитель)
            //
            // Token-2022 динамически вычислит PDA по этим seeds:
            //   1. Literal "compliance"    — фиксированный префикс
            //   2. AccountKey { index: 1 } — pubkey mint'а
            //   3. AccountKey { index: 3 } — pubkey owner'а source account
            //
            // Если кошелёк не прошёл KYC/AML, этот PDA не существует →
            // Anchor не сможет десериализовать → трансфер блокируется.
            // ---------------------------------------------------------------
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"compliance".to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint pubkey
                    Seed::AccountKey { index: 3 }, // sender owner pubkey
                ],
                false, // is_signer
                false, // is_writable (только чтение)
            )
            .map_err(|_| anchor_lang::prelude::ProgramError::InvalidAccountData)?,
            // ---------------------------------------------------------------
            // Extra Account #2 (index 7 в общем списке):
            // ComplianceRecord PDA RECEIVER (получатель)
            //
            // Owner получателя НЕ передаётся как отдельный account.
            // Извлекаем его из on-chain данных destination token account
            // (index 2) через AccountData:
            //   data_index: 32  — смещение поля owner в SPL Token account
            //   length: 32      — размер Pubkey (32 байта)
            //
            // SPL Token Account Layout:
            //   [0..32]   = mint
            //   [32..64]  = owner  ← извлекаем это
            //   [64..72]  = amount
            //   ...
            //
            // Это позволяет проверять compliance получателя без
            // необходимости передавать его owner как отдельный account.
            // ---------------------------------------------------------------
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"compliance".to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint pubkey
                    Seed::AccountData {
                        account_index: 2, // destination token account
                        data_index: 32,   // offset of owner field
                        length: 32,       // size of Pubkey
                    },
                ],
                false, // is_signer
                false, // is_writable
            )
            .map_err(|_| anchor_lang::prelude::ProgramError::InvalidAccountData)?,
        ];

        // Динамический расчёт размера аккаунта.
        // ExtraAccountMetaList::size_of() возвращает точный размер TLV-данных
        // для заданного количества extra account metas.
        let account_size = ExtraAccountMetaList::size_of(account_metas.len())
            .map_err(|_| anchor_lang::prelude::ProgramError::InvalidAccountData)?
            as u64;
        let lamports = Rent::get()?.minimum_balance(account_size as usize);

        // Формируем signer seeds для PDA (ExtraAccountMetaList PDA подписывает
        // собственное создание через create_account CPI).
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"extra-account-metas",
            mint_key.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ]];

        // CPI → System Program: создаём аккаунт с точным размером.
        // Owner = наш program (ctx.program_id), чтобы Token-2022 мог
        // корректно прочитать TLV данные.
        create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size,
            ctx.program_id,
        )?;

        // Инициализируем TLV-данные в созданном аккаунте.
        // ExecuteInstruction — маркерный тип из spl-transfer-hook-interface,
        // указывающий, что эти metas относятся к инструкции Execute.
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &account_metas,
        )
        .map_err(|_| anchor_lang::prelude::ProgramError::InvalidAccountData)?;

        msg!(
            "ExtraAccountMetaList initialized for mint {} ({} extra accounts, {} bytes)",
            ctx.accounts.mint.key(),
            account_metas.len(),
            account_size
        );
        Ok(())
    }

    // =========================================================================
    // Инструкция 6: Transfer Hook — CORE COMPLIANCE ENFORCEMENT
    // =========================================================================
    //
    // Эта функция вызывается Token-2022 program через CPI при КАЖДОМ трансфере
    // токенов нашего mint'а. Все аккаунты, переданные сюда — read-only
    // (ограничение SVM для Transfer Hook CPI).
    //
    // Логика проверки:
    //   1. Anti-spoofing: проверка check_is_transferring.
    //   2. AssetRecord: определяем легитимную authority актива.
    //   3. Sender compliance: ComplianceRecord PDA отправителя.
    //   4. Receiver compliance: ComplianceRecord PDA получателя.
    //   5. Status + expiration check для обоих.
    //
    // Если любая проверка не проходит — возвращаем ошибку → Token-2022
    // отменяет весь трансфер.
    //
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        // ---------------------------------------------------------------
        // Шаг 1: Anti-spoofing — убеждаемся, что hook вызван из реального
        // transfer'а, а не напрямую злоумышленником.
        //
        // Token-2022 устанавливает флаг `transferring` в TransferHookAccount
        // extension source token account. Мы проверяем этот флаг.
        // ---------------------------------------------------------------
        check_is_transferring(&ctx)?;

        // ---------------------------------------------------------------
        // Шаг 2: Загружаем AssetRecord и используем его authority как
        // единственный легитимный источник compliance-одобрений для mint'а.
        // ---------------------------------------------------------------
        let asset = &ctx.accounts.asset_record;

        // ---------------------------------------------------------------
        // Шаг 3: Compliance check отправителя (SENDER).
        //
        // ComplianceRecord PDA динамически разрешён через
        // ExtraAccountMetaList (index 6). Если PDA не существует
        // (кошелёк не в whitelist) — Anchor вернёт
        // AccountNotInitialized → трансфер блокируется.
        // ---------------------------------------------------------------
        let sender = &ctx.accounts.sender_compliance_record;
        require!(
            sender.authority == asset.authority,
            RwaError::ComplianceNotApproved
        );
        require!(
            sender.status == ComplianceStatus::Approved,
            RwaError::ComplianceNotApproved
        );
        if sender.expires_at > 0 {
            let now = Clock::get()?.unix_timestamp;
            require!(now < sender.expires_at, RwaError::ComplianceExpired);
        }

        // ---------------------------------------------------------------
        // Шаг 4: Compliance check получателя (RECEIVER).
        //
        // ComplianceRecord PDA разрешён через ExtraAccountMetaList
        // (index 7) с помощью AccountData: owner извлечён из
        // destination token account data на offset 32.
        //
        // Почему это важно: если получатель под санкциями или
        // не прошёл KYC, трансфер к нему должен быть заблокирован.
        //
        // receiver_compliance_record — UncheckedAccount, потому что
        // Anchor seeds constraint не поддерживает AccountData.
        // Верификация PDA + десериализация выполняются вручную.
        // ---------------------------------------------------------------
        {
            // Извлекаем owner получателя из destination token account data.
            // SPL Token account layout: [0..32] = mint, [32..64] = owner.
            let dest_info = ctx.accounts.destination_token.to_account_info();
            let dest_data = dest_info.try_borrow_data()?;
            let dest_owner = Pubkey::try_from(&dest_data[32..64])
                .map_err(|_| error!(RwaError::InvalidReceiverCompliancePda))?;

            // Ручная верификация PDA: проверяем, что переданный аккаунт
            // соответствует ожидаемому PDA с seeds ["compliance", mint, dest_owner].
            let (expected_pda, _bump) = Pubkey::find_program_address(
                &[
                    b"compliance",
                    ctx.accounts.mint.key().as_ref(),
                    dest_owner.as_ref(),
                ],
                ctx.program_id,
            );
            require!(
                ctx.accounts.receiver_compliance_record.key() == expected_pda,
                RwaError::InvalidReceiverCompliancePda
            );

            // Десериализация ComplianceRecord из данных аккаунта.
            // Если аккаунт не существует — data пустая, десериализация упадёт.
            let receiver_info = ctx.accounts.receiver_compliance_record.to_account_info();
            let receiver_data = receiver_info.try_borrow_data()?;

            // Пропускаем 8-байтный Anchor discriminator.
            require!(
                receiver_data.len() > 8,
                RwaError::ReceiverComplianceNotApproved
            );
            let receiver = ComplianceRecord::try_deserialize(&mut &receiver_data[..])?;

            require!(
                receiver.authority == asset.authority,
                RwaError::ReceiverComplianceNotApproved
            );
            require!(
                receiver.status == ComplianceStatus::Approved,
                RwaError::ReceiverComplianceNotApproved
            );
            if receiver.expires_at > 0 {
                let now = Clock::get()?.unix_timestamp;
                require!(now < receiver.expires_at, RwaError::ComplianceExpired);
            }
        }

        msg!(
            "✓ Transfer APPROVED: {} tokens | sender_level={:?}",
            amount,
            sender.level
        );
        Ok(())
    }

    // =========================================================================
    // Fallback: Маршрутизатор SPL Transfer Hook Interface → Anchor
    // =========================================================================
    //
    // КРИТИЧЕСКИ ВАЖНАЯ функция. Token-2022 program вызывает наш hook
    // используя SPL interface discriminator (SHA256 от
    // "spl-transfer-hook-interface:execute"), а НЕ Anchor discriminator
    // (SHA256 от "global:transfer_hook").
    //
    // Anchor не распознаёт SPL discriminator → вызов падает в fallback.
    // Здесь мы:
    //   1. Распаковываем SPL инструкцию
    //   2. Извлекаем amount
    //   3. Маршрутизируем в нашу Anchor-функцию transfer_hook через
    //      внутренний диспетчер __private::__global
    //
    // __private::__global::transfer_hook — это НЕ CPI, а прямой вызов
    // внутри того же call stack. Это обходит ограничение SVM на CPI depth
    // и сохраняет все Anchor constraints.
    //
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        // Распаковываем инструкцию из SPL interface формата
        let instruction = TransferHookInstruction::unpack(data)
            .map_err(|_| anchor_lang::prelude::ProgramError::InvalidInstructionData)?;

        match instruction {
            TransferHookInstruction::Execute { amount } => {
                // Конвертируем amount в little-endian bytes — формат,
                // который Anchor ожидает для десериализации u64 аргумента
                let amount_bytes = amount.to_le_bytes();

                // Прямой вызов Anchor-обработчика без CPI
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => {
                return Err(ProgramError::InvalidInstructionData.into());
            }
        }
    }
}

// =============================================================================
// Anti-Spoofing Helper
// =============================================================================
//
// Проверяет, что transfer_hook вызывается в контексте реального трансфера,
// а не напрямую злоумышленником. Token-2022 устанавливает флаг `transferring`
// в TransferHookAccount extension — мы проверяем его.
//

fn check_is_transferring(ctx: &Context<TransferHook>) -> Result<()> {
    let source_token_info = ctx.accounts.source_token.to_account_info();
    // ВАЖНО: immutable borrow. В Transfer Hook CPI все аккаунты read-only —
    // try_borrow_mut_data() упадёт с runtime error на read-only аккаунте.
    let account_data = source_token_info.try_borrow_data()?;

    // Распаковываем данные token account как PodStateWithExtensions (без Mut),
    // чтобы получить доступ к TransferHookAccount extension.
    // PodAccount — это plain-old-data представление SPL Token account.
    let account = spl_token_2022::extension::PodStateWithExtensions::<
        spl_token_2022::pod::PodAccount,
    >::unpack(&account_data)?;

    // Получаем TransferHookAccount extension и проверяем флаг `transferring`.
    // Token-2022 устанавливает этот флаг в true ТОЛЬКО во время реального
    // transfer'а. Это защищает от прямых вызовов hook'а злоумышленником.
    let extension =
        account.get_extension::<spl_token_2022::extension::transfer_hook::TransferHookAccount>()?;

    if !bool::from(extension.transferring) {
        return err!(RwaError::NotTransferring);
    }

    Ok(())
}

// =============================================================================
// Account Contexts
// =============================================================================

// --- InitializeAsset ---------------------------------------------------------

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeAsset<'info> {
    /// Authority — владелец/эмитент актива. Подписывает и оплачивает.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Mint токена, представляющего доли актива.
    /// Проверяем, что mint authority = наш authority.
    #[account(
        constraint = mint.mint_authority == COption::Some(authority.key()) @ RwaError::Unauthorized
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// PDA с метаданными актива.
    /// Seeds: ["asset", mint.key()]
    #[account(
        init,
        payer = authority,
        space = AssetRecord::space(&name),
        seeds = [b"asset", mint.key().as_ref()],
        bump,
    )]
    pub asset_record: Account<'info, AssetRecord>,

    pub system_program: Program<'info, System>,
}

// --- UpdateAsset -------------------------------------------------------------

#[derive(Accounts)]
pub struct UpdateAsset<'info> {
    /// Только authority актива может обновлять оценку.
    #[account(
        constraint = authority.key() == asset_record.authority @ RwaError::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// PDA с метаданными актива.
    #[account(
        mut,
        seeds = [b"asset", asset_record.mint.as_ref()],
        bump = asset_record.bump,
    )]
    pub asset_record: Account<'info, AssetRecord>,
}

// --- ApproveWallet -----------------------------------------------------------

#[derive(Accounts)]
pub struct ApproveWallet<'info> {
    /// Authority, которая управляет whitelist'ом.
    #[account(
        mut,
        constraint = authority.key() == asset_record.authority @ RwaError::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// Mint токена.
    pub mint: InterfaceAccount<'info, Mint>,

    /// AssetRecord PDA, привязывающий compliance-операции к эмитенту актива.
    #[account(
        seeds = [b"asset", mint.key().as_ref()],
        bump = asset_record.bump,
    )]
    pub asset_record: Account<'info, AssetRecord>,

    /// CHECK: Кошелёк, которому предоставляется compliance-статус.
    /// Это может быть любой кошелёк (не обязательно signer).
    pub wallet: UncheckedAccount<'info>,

    /// Per-wallet ComplianceRecord PDA.
    /// Seeds: ["compliance", mint.key(), wallet.key()]
    #[account(
        init,
        payer = authority,
        space = ComplianceRecord::SPACE,
        seeds = [b"compliance", mint.key().as_ref(), wallet.key().as_ref()],
        bump,
    )]
    pub compliance_record: Account<'info, ComplianceRecord>,

    pub system_program: Program<'info, System>,
}

// --- RevokeWallet ------------------------------------------------------------

#[derive(Accounts)]
pub struct RevokeWallet<'info> {
    /// Authority, отзывающая compliance.
    #[account(
        constraint = authority.key() == asset_record.authority @ RwaError::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// Per-wallet ComplianceRecord PDA — переводим статус в Revoked.
    #[account(
        mut,
        seeds = [
            b"compliance",
            compliance_record.mint.as_ref(),
            compliance_record.wallet.as_ref(),
        ],
        bump = compliance_record.bump,
        constraint = compliance_record.authority == asset_record.authority @ RwaError::Unauthorized,
    )]
    pub compliance_record: Account<'info, ComplianceRecord>,

    /// AssetRecord PDA, подтверждающий authority эмитента для этого mint'а.
    #[account(
        seeds = [b"asset", compliance_record.mint.as_ref()],
        bump = asset_record.bump,
    )]
    pub asset_record: Account<'info, AssetRecord>,
}

// --- InitializeExtraAccountMetaList ------------------------------------------

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    /// Плательщик за создание аккаунта.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: ExtraAccountMetaList PDA.
    /// Seeds: ["extra-account-metas", mint.key()]
    /// Мы НЕ используем Anchor `init` здесь — создаём через create_account CPI
    /// для динамического расчёта space через ExtraAccountMetaList::size_of().
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: AccountInfo<'info>,

    /// Mint, для которого настраиваем Transfer Hook.
    pub mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

// --- TransferHook (Execute context) ------------------------------------------
//
// Порядок аккаунтов КРИТИЧЕСКИ ВАЖЕН и задан спецификацией Transfer Hook:
//   index 0: source_token      — source token account
//   index 1: mint              — mint
//   index 2: destination_token — destination token account
//   index 3: owner             — owner/authority source token account
//   index 4: extra_account_meta_list — ExtraAccountMetaList PDA
//   index 5: asset_record — extra account (AssetRecord PDA)
//   index 6: sender_compliance_record — extra account (ComplianceRecord PDA sender)
//   index 7: receiver_compliance_record — extra account (ComplianceRecord PDA receiver)
//

#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// Source token account (откуда переводят).
    /// Проверяем: принадлежит нашему mint'у и authority = owner.
    #[account(
        token::mint = mint,
        token::authority = owner,
    )]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    /// Mint токена.
    pub mint: InterfaceAccount<'info, Mint>,

    /// Destination token account (куда переводят).
    #[account(
        token::mint = mint,
    )]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Owner/authority source token account.
    /// Это может быть SystemAccount или PDA другой программы.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList PDA — автоматически разрешён Token-2022.
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// AssetRecord PDA (index 5).
    #[account(
        seeds = [b"asset", mint.key().as_ref()],
        bump = asset_record.bump,
    )]
    pub asset_record: Account<'info, AssetRecord>,

    /// ComplianceRecord PDA отправителя (index 6).
    /// Динамически разрешён Token-2022 через ExtraAccountMetaList seeds:
    ///   ["compliance", AccountKey(1)=mint, AccountKey(3)=owner]
    /// Если PDA не существует → AccountNotInitialized → трансфер блокируется.
    #[account(
        seeds = [b"compliance", mint.key().as_ref(), owner.key().as_ref()],
        bump = sender_compliance_record.bump,
    )]
    pub sender_compliance_record: Account<'info, ComplianceRecord>,

    /// ComplianceRecord PDA получателя (index 7).
    /// Динамически разрешён Token-2022 через ExtraAccountMetaList seeds:
    ///   ["compliance", AccountKey(1)=mint, AccountData(2, 32, 32)=dest owner]
    /// Owner получателя извлекается из on-chain данных destination token account:
    ///   SPL Token layout offset 32..64 = owner pubkey.
    /// Используем UncheckedAccount + ручная десериализация, т.к. Anchor seeds
    /// constraint не может ссылаться на данные другого аккаунта (AccountData).
    /// Верификацию PDA выполняем вручную в transfer_hook.
    /// CHECK: PDA проверен вручную в transfer_hook через Pubkey::find_program_address.
    pub receiver_compliance_record: UncheckedAccount<'info>,
}

// =============================================================================
// State: On-Chain Accounts
// =============================================================================

/// Метаданные токенизированного реального актива.
///
/// Содержит всю информацию, необходимую для proof-of-asset:
/// - Название и тип актива
/// - Оценка в USD
/// - URI документов подтверждения (IPFS/Arweave)
/// - SHA256 хэш документов (immutable proof)
#[account]
pub struct AssetRecord {
    /// Authority (эмитент), управляющая активом.
    pub authority: Pubkey, // 32
    /// Mint SPL Token-2022, представляющий доли.
    pub mint: Pubkey, // 32
    /// Название актива (e.g. "Apartment #42, Almaty").
    pub name: String, // 4 + len
    /// Тип актива.
    pub asset_type: AssetType, // 1
    /// Планируемое количество долей, заявленное в metadata.
    pub planned_supply: u64, // 8
    /// Оценка актива в USD (центы для точности, e.g. 15000000 = $150,000.00).
    pub valuation_usd: u64, // 8
    /// URI метаданных/документов (IPFS CID или HTTPS URL).
    pub document_uri: String, // 4 + len
    /// SHA256 хэш пакета документов (proof-of-asset).
    pub document_hash: [u8; 32], // 32
    /// Unix timestamp создания.
    pub created_at: i64, // 8
    /// Флаг активности.
    pub is_active: bool, // 1
    /// Bump seed PDA.
    pub bump: u8, // 1
}

impl AssetRecord {
    /// Расчёт space с фиксированным MAX_NAME_LEN.
    ///
    /// ВАЖНО: name выделяется по MAX_NAME_LEN (а не name.len()),
    /// что означает — имя актива задаётся ОДИН РАЗ при создании
    /// и НЕ может быть изменено (realloc не используется).
    /// Это осознанное решение: имя RWA актива (e.g. "Apartment #42")
    /// по своей природе immutable.
    pub fn space(_name: &str) -> usize {
        8 +     // Anchor discriminator
        32 +    // authority
        32 +    // mint
        4 + MAX_NAME_LEN + // name (String = 4 bytes length prefix + MAX data)
        1 +     // asset_type (enum, 1 byte)
        8 +     // planned_supply
        8 +     // valuation_usd
        4 + MAX_URI_LEN + // document_uri (worst case)
        32 +    // document_hash
        8 +     // created_at
        1 +     // is_active
        1 // bump
    }
}

/// Compliance-статус конкретного кошелька для конкретного mint'а.
///
/// Per-wallet PDA обеспечивает O(1) проверку в Transfer Hook
/// и неограниченное количество whitelisted кошельков.
#[account]
pub struct ComplianceRecord {
    /// Mint, для которого действует этот compliance record.
    pub mint: Pubkey, // 32
    /// Кошелёк, которому выдан compliance-статус.
    pub wallet: Pubkey, // 32
    /// Authority, выдавшая статус.
    pub authority: Pubkey, // 32
    /// Текущий статус.
    pub status: ComplianceStatus, // 1
    /// Уровень проверки (для аудита).
    pub level: ComplianceLevel, // 1
    /// Unix timestamp одобрения.
    pub approved_at: i64, // 8
    /// Unix timestamp истечения (0 = бессрочно).
    pub expires_at: i64, // 8
    /// Bump seed PDA.
    pub bump: u8, // 1
}

impl ComplianceRecord {
    /// Фиксированный размер — все поля фиксированной длины.
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1 + 1 + 8 + 8 + 1;
}

// =============================================================================
// Enums
// =============================================================================

/// Тип реального актива.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetType {
    /// Недвижимость (квартира, дом, коммерция).
    RealEstate,
    /// Государственные облигации / treasuries.
    Bond,
    /// Товар (золото, нефть и т.д.).
    Commodity,
    /// Доля в фонде / private equity.
    Equity,
    /// Прочее.
    Other,
}

/// Статус compliance-проверки.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ComplianceStatus {
    /// Ожидает проверки.
    Pending,
    /// Одобрен — трансферы разрешены.
    Approved,
    /// Отозван — трансферы заблокированы.
    Revoked,
}

/// Уровень KYC/AML проверки.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ComplianceLevel {
    /// Базовая проверка (email + phone).
    Basic,
    /// Стандартная KYC (документы).
    Standard,
    /// Полная проверка (institutional-grade AML).
    Enhanced,
}

// =============================================================================
// Errors
// =============================================================================

#[error_code]
pub enum RwaError {
    /// Имя актива превышает максимальную длину.
    #[msg("Asset name exceeds maximum length")]
    NameTooLong,

    /// URI документа превышает максимальную длину.
    #[msg("Document URI exceeds maximum length")]
    UriTooLong,

    /// Некорректное количество долей.
    #[msg("Planned supply must be greater than zero")]
    InvalidSupply,

    /// Некорректная оценка актива.
    #[msg("Valuation must be greater than zero")]
    InvalidValuation,

    /// Вызывающий не является authority.
    #[msg("Unauthorized: caller is not the authority")]
    Unauthorized,

    /// Кошелёк отправителя не прошёл compliance-проверку.
    /// Это основная ошибка, блокирующая трансфер.
    #[msg("Compliance check failed: sender wallet not approved")]
    ComplianceNotApproved,

    /// Кошелёк получателя не прошёл compliance-проверку.
    #[msg("Compliance check failed: receiver wallet not approved")]
    ReceiverComplianceNotApproved,

    /// Срок действия compliance-статуса истёк.
    #[msg("Compliance approval has expired")]
    ComplianceExpired,

    /// Hook вызван вне контекста трансфера (anti-spoofing).
    #[msg("Transfer hook invoked outside of a transfer context")]
    NotTransferring,

    /// PDA receiver compliance record не прошёл верификацию.
    #[msg("Invalid receiver compliance PDA")]
    InvalidReceiverCompliancePda,
}
