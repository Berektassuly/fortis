import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { createOrder } from "@/lib/services/orders";
import { ServiceError } from "@/lib/services/service-error";
import { ensureMarketplaceUser } from "@/lib/services/users";
import { isSupabaseConfigured } from "@/lib/supabase/config";
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
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new ServiceError(401, "Sign in before placing an order.");
    }

    await ensureMarketplaceUser(supabase, {
      email: user.email ?? null,
      id: user.id,
    });

    const payload = await request.json();
    const order = await createOrder(supabase, payload, user.id);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to create order");
  }
}
