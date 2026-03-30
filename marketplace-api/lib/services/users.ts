import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { PublicKey } from "@solana/web3.js";

import { ServiceError } from "@/lib/services/service-error";
import type { Database } from "@/lib/supabase/database.types";

type MarketplaceUserRecord = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "id" | "email" | "solana_wallet_address"
>;

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
