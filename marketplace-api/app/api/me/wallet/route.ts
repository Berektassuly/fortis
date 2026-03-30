import { NextResponse } from "next/server";
import { z } from "zod";

import { toErrorResponse } from "@/lib/route-errors";
import { bindSolanaWalletAddress, requireMarketplaceUser } from "@/lib/services/users";
import { ServiceError } from "@/lib/services/service-error";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bindWalletSchema = z.object({
  walletAddress: z.string().trim().min(1),
});

async function requireAuthenticatedMarketplaceContext() {
  if (!isSupabaseConfigured()) {
    throw new ServiceError(
      503,
      "Supabase Auth is not configured for this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.",
    );
  }

  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ServiceError(401, "Sign in to continue.");
  }

  return {
    marketplaceUser: await requireMarketplaceUser(supabase, user.id),
    supabase,
    supabaseUserId: user.id,
  };
}

export async function GET() {
  try {
    const { marketplaceUser } = await requireAuthenticatedMarketplaceContext();

    return NextResponse.json({
      id: marketplaceUser.id,
      email: marketplaceUser.email,
      solanaWalletAddress: marketplaceUser.solanaWalletAddress,
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to resolve the current marketplace wallet");
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, supabaseUserId } = await requireAuthenticatedMarketplaceContext();
    const payload = bindWalletSchema.parse(await request.json());
    const marketplaceUser = await bindSolanaWalletAddress(
      supabase,
      supabaseUserId,
      payload.walletAddress,
    );

    return NextResponse.json({
      id: marketplaceUser.id,
      email: marketplaceUser.email,
      solanaWalletAddress: marketplaceUser.solanaWalletAddress,
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to bind the connected wallet");
  }
}
