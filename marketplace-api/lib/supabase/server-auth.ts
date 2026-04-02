import type { SupabaseClient, User } from "@supabase/supabase-js";

import { ServiceError } from "@/lib/services/service-error";
import {
  ensureMarketplaceUser,
  type AuthenticatedMarketplaceUser,
} from "@/lib/services/users";
import type { Database } from "@/lib/supabase/database.types";
import { extractWalletAddressFromSupabaseUser } from "@/lib/supabase/wallet-auth";

export function toAuthenticatedMarketplaceUser(
  user: Pick<User, "app_metadata" | "id" | "identities">,
): AuthenticatedMarketplaceUser {
  const walletAddress = extractWalletAddressFromSupabaseUser(user);

  if (!walletAddress) {
    throw new ServiceError(
      401,
      "Sign in with your Solana wallet to continue.",
    );
  }

  return {
    authUserId: user.id,
    walletAddress,
  };
}

export async function requireAuthenticatedMarketplaceContext(
  supabase: SupabaseClient<Database>,
) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ServiceError(401, "Sign in with your Solana wallet to continue.");
  }

  const authUser = toAuthenticatedMarketplaceUser(user);

  return {
    authUser,
    marketplaceUser: await ensureMarketplaceUser(supabase, authUser),
    supabaseUser: user,
  };
}
