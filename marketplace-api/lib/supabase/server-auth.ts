import type { SupabaseClient, User } from "@supabase/supabase-js";

import { ServiceError } from "@/lib/services/service-error";
import {
  ensureMarketplaceUser,
  type AuthenticatedMarketplaceUser,
} from "@/lib/services/users";
import type { Database } from "@/lib/supabase/database.types";
import { resolveMarketplaceSession } from "@/lib/supabase/marketplace-session";

export async function toAuthenticatedMarketplaceUser(
  supabase: Pick<SupabaseClient<Database>, "from">,
  user: Pick<User, "app_metadata" | "id" | "identities">,
): Promise<AuthenticatedMarketplaceUser> {
  const authUser = await resolveMarketplaceSession(supabase, user);

  if (!authUser) {
    throw new ServiceError(
      401,
      "Sign in with your Solana wallet to continue.",
    );
  }

  return authUser;
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

  const authUser = await toAuthenticatedMarketplaceUser(supabase, user);

  return {
    authUser,
    marketplaceUser: await ensureMarketplaceUser(supabase, authUser),
    supabaseUser: user,
  };
}
