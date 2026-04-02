import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { createOrder } from "@/lib/services/orders";
import { ServiceError } from "@/lib/services/service-error";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireAuthenticatedMarketplaceContext } from "@/lib/supabase/server-auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      throw new ServiceError(
        503,
        "Supabase Auth is not configured for this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.",
      );
    }

    const supabase = createClient();
    const { authUser } = await requireAuthenticatedMarketplaceContext(supabase);

    const payload = await request.json();
    const order = await createOrder(supabase, payload, authUser.walletAddress);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to create order");
  }
}
