import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { PublicKey } from "@solana/web3.js";

import { env } from "@/lib/env";
import { ServiceError } from "@/lib/services/service-error";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type MarketplaceUserRecord = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "id" | "email" | "solana_wallet_address"
>;

export interface AuthenticatedMarketplaceUser {
  email: string | null;
  id: string;
}

export interface MarketplaceUser {
  id: number;
  email: string;
  solanaWalletAddress: string | null;
}

function toMarketplaceUser(user: MarketplaceUserRecord): MarketplaceUser {
  return {
    id: user.id,
    email: user.email,
    solanaWalletAddress: user.solana_wallet_address ?? null,
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

function normalizeAuthEmail(authUser: AuthenticatedMarketplaceUser) {
  const normalizedEmail = authUser.email?.trim().toLowerCase();
  return normalizedEmail || `${authUser.id}@auth.local`;
}

async function getMarketplaceUserRecord(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<MarketplaceUserRecord | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id,email,solana_wallet_address")
    .eq("auth_user_id", authUserId)
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
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        auth_user_id: authUser.id,
        email: normalizeAuthEmail(authUser),
      },
      {
        onConflict: "auth_user_id",
      },
    )
    .select("id,email,solana_wallet_address")
    .maybeSingle();

  if (isUniqueViolation(error, "email") || isRowLevelSecurityViolation(error)) {
    return null;
  }

  if (error) {
    throw new ServiceError(500, error.message);
  }

  return data;
}

async function upsertMarketplaceUserRecordWithAdmin(authUser: AuthenticatedMarketplaceUser) {
  const supabase = createAdminClient();
  const normalizedEmail = normalizeAuthEmail(authUser);

  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select("id,email,solana_wallet_address")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (existingUserError) {
    throw new ServiceError(500, existingUserError.message);
  }

  if (existingUser) {
    return existingUser;
  }

  const { data: claimedUser, error: claimError } = await supabase
    .from("users")
    .update({
      auth_user_id: authUser.id,
      email: normalizedEmail,
    })
    .eq("email", normalizedEmail)
    .is("auth_user_id", null)
    .select("id,email,solana_wallet_address")
    .maybeSingle();

  if (claimError) {
    throw new ServiceError(500, claimError.message);
  }

  if (claimedUser) {
    return claimedUser;
  }

  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        auth_user_id: authUser.id,
        email: normalizedEmail,
      },
      {
        onConflict: "auth_user_id",
      },
    )
    .select("id,email,solana_wallet_address")
    .maybeSingle();

  if (isUniqueViolation(error, "email")) {
    throw new ServiceError(
      409,
      "Another marketplace profile already uses this email address. Resolve the duplicate profile in Supabase before continuing.",
    );
  }

  if (error) {
    throw new ServiceError(500, error.message);
  }

  if (!data) {
    throw new ServiceError(500, "Failed to synchronize the marketplace profile.");
  }

  return data;
}

export async function ensureMarketplaceUser(
  supabase: SupabaseClient<Database>,
  authUser: AuthenticatedMarketplaceUser,
): Promise<MarketplaceUser> {
  const existingUser = await getMarketplaceUserRecord(supabase, authUser.id);

  if (existingUser) {
    return toMarketplaceUser(existingUser);
  }

  const insertedUser = await upsertMarketplaceUserRecord(supabase, authUser);

  if (insertedUser) {
    return toMarketplaceUser(insertedUser);
  }

  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const adminUser = await upsertMarketplaceUserRecordWithAdmin(authUser);
    return toMarketplaceUser(adminUser);
  }

  const refreshedUser = await getMarketplaceUserRecord(supabase, authUser.id);

  if (refreshedUser) {
    return toMarketplaceUser(refreshedUser);
  }

  throw new ServiceError(
    409,
    "Your marketplace profile is not ready yet. Re-run the latest Supabase migration or configure SUPABASE_SERVICE_ROLE_KEY so Fortis can repair the profile mapping automatically.",
  );
}

export async function requireMarketplaceUser(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<MarketplaceUser> {
  const user = await getMarketplaceUserRecord(supabase, authUserId);

  if (!user) {
    throw new ServiceError(
      409,
      "Your marketplace profile is not ready yet. Please sign out and sign in again.",
    );
  }

  return toMarketplaceUser(user);
}

function normalizeWalletAddress(walletAddress: string) {
  const value = walletAddress.trim();

  if (!value) {
    throw new ServiceError(400, "Connect a Solana wallet before continuing.");
  }

  try {
    return new PublicKey(value).toBase58();
  } catch (error) {
    throw new ServiceError(
      400,
      error instanceof Error ? error.message : "Invalid Solana wallet address.",
    );
  }
}

export async function bindSolanaWalletAddress(
  supabase: SupabaseClient<Database>,
  authUserId: string,
  walletAddress: string,
) {
  const marketplaceUser = await requireMarketplaceUser(supabase, authUserId);
  const normalizedWalletAddress = normalizeWalletAddress(walletAddress);

  const { data, error } = await supabase
    .from("users")
    .update({
      solana_wallet_address: normalizedWalletAddress,
    })
    .eq("id", marketplaceUser.id)
    .select("id,email,solana_wallet_address")
    .single();

  if (isUniqueViolation(error, "solana_wallet_address")) {
    throw new ServiceError(
      409,
      "This wallet is already linked to another Fortis account. Disconnect it there first.",
    );
  }

  if (error) {
    throw new ServiceError(500, error.message);
  }

  if (!data) {
    throw new ServiceError(500, "Failed to update the marketplace wallet profile.");
  }

  return toMarketplaceUser(data);
}
