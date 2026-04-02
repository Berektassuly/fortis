import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { extractWalletAddressFromSupabaseUser } from "@/lib/supabase/wallet-auth";

export interface ResolvedMarketplaceSession {
  authUserId: string;
  walletAddress: string;
}

export async function resolveMarketplaceSession(
  supabase: Pick<SupabaseClient<Database>, "from">,
  user: Pick<User, "app_metadata" | "id" | "identities"> | null | undefined,
): Promise<ResolvedMarketplaceSession | null> {
  if (!user) {
    return null;
  }

  const walletAddress = extractWalletAddressFromSupabaseUser(user);

  if (walletAddress) {
    return {
      authUserId: user.id,
      walletAddress,
    };
  }

  // Supabase Web3 sessions can arrive without provider identity data on the
  // JS user payload. Fall back to the RLS-protected marketplace profile row.
  const { data, error } = await supabase
    .from("users")
    .select("auth_user_id,solana_wallet_address")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.auth_user_id || !data.solana_wallet_address) {
    return null;
  }

  return {
    authUserId: data.auth_user_id,
    walletAddress: data.solana_wallet_address,
  };
}
