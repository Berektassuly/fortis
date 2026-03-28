import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { createListing, getListings } from "@/lib/services/listings";

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
    const payload = await request.json();
    const listing = await createListing(payload);
    revalidatePath("/");
    return NextResponse.json(listing, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to create listing");
  }
}
