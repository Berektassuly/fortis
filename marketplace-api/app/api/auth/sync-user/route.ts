import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { ServiceError } from "@/lib/services/service-error";
import { syncSupabaseAuthUser } from "@/lib/services/users";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  try {
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
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to sync the authenticated user");
  }
}
