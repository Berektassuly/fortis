import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { toErrorResponse } from "@/lib/route-errors";
import { verifyFortisWebhookSignature } from "@/lib/services/fortis-client";
import { applyFortisSuccessWebhook } from "@/lib/services/orders";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!env.FORTIS_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "FORTIS_WEBHOOK_SECRET is not configured" }, { status: 503 });
    }

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
        { status: 503 },
      );
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-fortis-signature");

    if (!verifyFortisWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    let payload: unknown = {};
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody) as unknown;
      } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
      }
    }

    const supabase = createAdminClient();
    const order = await applyFortisSuccessWebhook(supabase, payload);

    return NextResponse.json(order);
  } catch (error) {
    return toErrorResponse(error, "Failed to process Fortis webhook");
  }
}
