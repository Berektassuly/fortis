import type { PostgrestError, SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  extractWalletAddressFromSupabaseUser,
  normalizeWalletAddress,
} from "@/lib/supabase/wallet-auth";

export interface ResolvedMarketplaceSession {
  authUserId: string;
  walletAddress: string;
}

type MarketplaceSessionSupabaseClient = Pick<SupabaseClient<Database>, "from" | "rpc">;

function isMissingWalletIdentityFunctionError(error: PostgrestError | null) {
  if (!error) {
    return false;
  }

  return (
    error.code === "PGRST202" ||
    `${error.message ?? ""} ${error.details ?? ""}`
      .toLowerCase()
      .includes("current_solana_wallet_address")
  );
}

async function resolveWalletAddressFromAuthContext(
  supabase: Pick<SupabaseClient<Database>, "rpc">,
) {
  const { data, error } = await supabase.rpc("current_solana_wallet_address");

  if (error) {
    if (isMissingWalletIdentityFunctionError(error)) {
      return null;
    }

    throw error;
  }

  return normalizeWalletAddress(data ?? "");
}

export async function resolveMarketplaceSession(
  supabase: MarketplaceSessionSupabaseClient,
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

  // Supabase Web3 sessions can arrive before the JS user payload exposes the
  // wallet identity or before the public.users row has been synchronized.
  // Resolve the wallet from the authenticated database context first so the
  // server can still recognize a valid SIWS session and repair the profile row.
  const walletAddressFromAuthContext = await resolveWalletAddressFromAuthContext(supabase);

  if (walletAddressFromAuthContext) {
    return {
      authUserId: user.id,
      walletAddress: walletAddressFromAuthContext,
    };
  }

  // Fall back to the RLS-protected marketplace profile row for projects that
  // have the wallet-first migration applied but the auth payload is sparse.
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
