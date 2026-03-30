import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { createListing, getListings } from "@/lib/services/listings";
import { ServiceError } from "@/lib/services/service-error";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createClient();
    const listings = await getListings(supabase);
    return NextResponse.json(listings);
  } catch (error) {
    return toErrorResponse(error, "Failed to load listings");
  }
}

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
      throw new ServiceError(401, "Sign in to publish a Fortis listing.");
    }

    const payload = await request.json();
    const listing = await createListing(supabase, payload, user.id);
    revalidatePath("/");
    return NextResponse.json(listing, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to create listing");
  }
}
