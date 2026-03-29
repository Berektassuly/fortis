import { NextResponse } from "next/server";
import { z } from "zod";

import { toErrorResponse } from "@/lib/route-errors";
import { bindSolanaWalletAddress, syncSupabaseAuthUser } from "@/lib/services/users";
import { ServiceError } from "@/lib/services/service-error";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bindWalletSchema = z.object({
  walletAddress: z.string().trim().min(1),
});

async function requireMarketplaceUser() {
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
    prismaUser: await syncSupabaseAuthUser(user),
    supabaseUser: user,
  };
}

export async function GET() {
  try {
    const { prismaUser } = await requireMarketplaceUser();

    return NextResponse.json({
      id: prismaUser.id,
      email: prismaUser.email,
      solanaWalletAddress: prismaUser.solanaWalletAddress,
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to resolve the current marketplace wallet");
  }
}

export async function POST(request: Request) {
  try {
    const { supabaseUser } = await requireMarketplaceUser();
    const payload = bindWalletSchema.parse(await request.json());
    const prismaUser = await bindSolanaWalletAddress(supabaseUser, payload.walletAddress);

    return NextResponse.json({
      id: prismaUser.id,
      email: prismaUser.email,
      solanaWalletAddress: prismaUser.solanaWalletAddress,
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to bind the connected wallet");
  }
}
