import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { ServiceError } from "@/lib/services/service-error";
import { syncSupabaseAuthUser } from "@/lib/services/users";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  try {
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

    const prismaUser = await syncSupabaseAuthUser(user);

    return NextResponse.json({
      id: prismaUser.id,
      email: prismaUser.email,
      solanaWalletAddress: prismaUser.solanaWalletAddress,
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to sync the authenticated user");
  }
}
