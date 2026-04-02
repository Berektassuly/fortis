import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { ServiceError } from "@/lib/services/service-error";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireAuthenticatedMarketplaceContext } from "@/lib/supabase/server-auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      throw new ServiceError(
        503,
        "Supabase Auth is not configured for this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.",
      );
    }

    const supabase = createClient();
    const { marketplaceUser } = await requireAuthenticatedMarketplaceContext(supabase);

    return NextResponse.json({
      authUserId: marketplaceUser.authUserId,
      id: marketplaceUser.id,
      solanaWalletAddress: marketplaceUser.solanaWalletAddress,
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to resolve the current marketplace wallet");
  }
}
