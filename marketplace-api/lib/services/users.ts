import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { ServiceError } from "@/lib/services/service-error";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeWalletAddress } from "@/lib/supabase/wallet-auth";

type MarketplaceUserRecord = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "auth_user_id" | "id" | "solana_wallet_address"
>;

export interface AuthenticatedMarketplaceUser {
  authUserId: string;
  walletAddress: string;
}

export interface MarketplaceUser {
  authUserId: string | null;
  id: string;
  solanaWalletAddress: string;
}

function toMarketplaceUser(user: MarketplaceUserRecord): MarketplaceUser {
  return {
    authUserId: user.auth_user_id ?? null,
    id: user.id,
    solanaWalletAddress: user.solana_wallet_address,
  };
}

function isUniqueViolation(error: PostgrestError | null, columnName?: string) {
  if (!error || error.code !== "23505") {
    return false;
  }

  if (!columnName) {
    return true;
  }

  const details = `${error.details ?? ""} ${error.message}`.toLowerCase();
  return details.includes(columnName.toLowerCase());
}

function isRowLevelSecurityViolation(error: PostgrestError | null) {
  if (!error) {
    return false;
  }

  if (error.code === "42501") {
    return true;
  }

  const details = `${error.details ?? ""} ${error.message}`.toLowerCase();
  return details.includes("row-level security");
}

function requireNormalizedWalletAddress(walletAddress: string) {
  const normalizedWalletAddress = normalizeWalletAddress(walletAddress);

  if (!normalizedWalletAddress) {
    throw new ServiceError(400, "Connect a valid Solana wallet before continuing.");
  }

  return normalizedWalletAddress;
}

async function getMarketplaceUserRecordByAuthUserId(
  supabase: SupabaseClient<Database>,
  authUserId: string,
) {
  const { data, error } = await supabase
    .from("users")
    .select("id,auth_user_id,solana_wallet_address")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    throw new ServiceError(500, error.message);
  }

  return data;
}

async function getMarketplaceUserRecordByWalletAddress(
  supabase: SupabaseClient<Database>,
  walletAddress: string,
) {
  const normalizedWalletAddress = requireNormalizedWalletAddress(walletAddress);
  const { data, error } = await supabase
    .from("users")
    .select("id,auth_user_id,solana_wallet_address")
    .eq("id", normalizedWalletAddress)
    .maybeSingle();

  if (error) {
    throw new ServiceError(500, error.message);
  }

  return data;
}

async function upsertMarketplaceUserRecord(
  supabase: SupabaseClient<Database>,
  authUser: AuthenticatedMarketplaceUser,
) {
  const normalizedWalletAddress = requireNormalizedWalletAddress(authUser.walletAddress);
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        auth_user_id: authUser.authUserId,
        id: normalizedWalletAddress,
        solana_wallet_address: normalizedWalletAddress,
      },
      {
        onConflict: "id",
      },
    )
    .select("id,auth_user_id,solana_wallet_address")
    .maybeSingle();

  if (
    isRowLevelSecurityViolation(error) ||
    isUniqueViolation(error, "auth_user_id") ||
    isUniqueViolation(error, "solana_wallet_address")
  ) {
    return null;
  }

  if (error) {
    throw new ServiceError(500, error.message);
  }

  return data;
}

async function repairMarketplaceUserRecordWithAdmin(authUser: AuthenticatedMarketplaceUser) {
  const supabase = createAdminClient();
  const normalizedWalletAddress = requireNormalizedWalletAddress(authUser.walletAddress);

  const { data: existingByAuthUserId, error: existingByAuthUserIdError } = await supabase
    .from("users")
    .select("id,auth_user_id,solana_wallet_address")
    .eq("auth_user_id", authUser.authUserId)
    .maybeSingle();

  if (existingByAuthUserIdError) {
    throw new ServiceError(500, existingByAuthUserIdError.message);
  }

  if (existingByAuthUserId && existingByAuthUserId.id !== normalizedWalletAddress) {
    const { error } = await supabase
      .from("users")
      .update({
        auth_user_id: null,
      })
      .eq("auth_user_id", authUser.authUserId)
      .neq("id", normalizedWalletAddress);

    if (error) {
      throw new ServiceError(500, error.message);
    }
  }

  const { data: existingByWallet, error: existingByWalletError } = await supabase
    .from("users")
    .select("id,auth_user_id,solana_wallet_address")
    .eq("id", normalizedWalletAddress)
    .maybeSingle();

  if (existingByWalletError) {
    throw new ServiceError(500, existingByWalletError.message);
  }

  if (existingByWallet) {
    const { data, error } = await supabase
      .from("users")
      .update({
        auth_user_id: authUser.authUserId,
        solana_wallet_address: normalizedWalletAddress,
      })
      .eq("id", normalizedWalletAddress)
      .select("id,auth_user_id,solana_wallet_address")
      .maybeSingle();

    if (error) {
      throw new ServiceError(500, error.message);
    }

    if (data) {
      return data;
    }
  }

  const { data, error } = await supabase
    .from("users")
    .insert({
      auth_user_id: authUser.authUserId,
      id: normalizedWalletAddress,
      solana_wallet_address: normalizedWalletAddress,
    })
    .select("id,auth_user_id,solana_wallet_address")
    .maybeSingle();

  if (isUniqueViolation(error, "id") || isUniqueViolation(error, "solana_wallet_address")) {
    throw new ServiceError(
      409,
      "This wallet is already linked to another Fortis identity. Sign in with that wallet instead.",
    );
  }

  if (error) {
    throw new ServiceError(500, error.message);
  }

  if (!data) {
    throw new ServiceError(500, "Failed to synchronize the wallet-based marketplace profile.");
  }

  return data;
}

export async function ensureMarketplaceUser(
  supabase: SupabaseClient<Database>,
  authUser: AuthenticatedMarketplaceUser,
): Promise<MarketplaceUser> {
  const normalizedWalletAddress = requireNormalizedWalletAddress(authUser.walletAddress);
  const existingByAuthUserId = await getMarketplaceUserRecordByAuthUserId(
    supabase,
    authUser.authUserId,
  );

  if (existingByAuthUserId && existingByAuthUserId.id === normalizedWalletAddress) {
    return toMarketplaceUser(existingByAuthUserId);
  }

  const existingByWallet = await getMarketplaceUserRecordByWalletAddress(
    supabase,
    normalizedWalletAddress,
  );

  if (
    existingByWallet &&
    (!existingByWallet.auth_user_id || existingByWallet.auth_user_id === authUser.authUserId)
  ) {
    const claimedUser = await upsertMarketplaceUserRecord(supabase, authUser);

    if (claimedUser) {
      return toMarketplaceUser(claimedUser);
    }
  }

  const insertedUser = await upsertMarketplaceUserRecord(supabase, authUser);

  if (insertedUser) {
    return toMarketplaceUser(insertedUser);
  }

  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    const adminUser = await repairMarketplaceUserRecordWithAdmin(authUser);
    return toMarketplaceUser(adminUser);
  }

  const refreshedUser =
    (await getMarketplaceUserRecordByAuthUserId(supabase, authUser.authUserId)) ??
    (await getMarketplaceUserRecordByWalletAddress(supabase, normalizedWalletAddress));

  if (refreshedUser) {
    return toMarketplaceUser(refreshedUser);
  }

  throw new ServiceError(
    409,
    "Your wallet profile is not ready yet. Re-run the latest Supabase migration or configure SUPABASE_SERVICE_ROLE_KEY so Fortis can repair the SIWS profile mapping automatically.",
  );
}

export async function requireMarketplaceUser(
  supabase: SupabaseClient<Database>,
  walletAddress: string,
): Promise<MarketplaceUser> {
  const normalizedWalletAddress = requireNormalizedWalletAddress(walletAddress);
  const user = await getMarketplaceUserRecordByWalletAddress(supabase, normalizedWalletAddress);

  if (!user) {
    throw new ServiceError(
      409,
      "Your wallet profile is not ready yet. Sign out and sign in with the same wallet again.",
    );
  }

  return toMarketplaceUser(user);
}
