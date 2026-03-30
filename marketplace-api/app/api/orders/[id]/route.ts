import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { getOrderForUser } from "@/lib/services/orders";
import { ServiceError } from "@/lib/services/service-error";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: { id: string } },
) {
  try {
    if (!isSupabaseConfigured()) {
      throw new ServiceError(
        503,
        "Supabase Auth is not configured for this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.",
      );
    }

    const orderId = Number(context.params.id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new ServiceError(400, "Invalid order id.");
    }

    const supabase = createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new ServiceError(401, "Sign in before checking order status.");
    }

    const order = await getOrderForUser(supabase, orderId, user.id);
    return NextResponse.json(order);
  } catch (error) {
    return toErrorResponse(error, "Failed to load the Fortis order");
  }
}
