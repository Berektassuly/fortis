import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { createListing, getListings } from "@/lib/services/listings";
import { ServiceError } from "@/lib/services/service-error";
import { syncSupabaseAuthUser } from "@/lib/services/users";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const listings = await getListings();
    return NextResponse.json(listings);
  } catch (error) {
    return toErrorResponse(error, "Failed to load listings");
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new ServiceError(401, "Войдите в аккаунт, чтобы публиковать объявления.");
    }

    const prismaUser = await syncSupabaseAuthUser(user);
    const payload = await request.json();
    const listing = await createListing(payload, prismaUser.id);
    revalidatePath("/");
    return NextResponse.json(listing, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to create listing");
  }
}
