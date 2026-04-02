import { type NextRequest, NextResponse } from "next/server";

import { getSafeRedirectPath } from "@/lib/supabase/redirects";

export async function GET(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  const next = getSafeRedirectPath(request.nextUrl.searchParams.get("next"), "/");

  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", next);
  loginUrl.searchParams.set(
    "error",
    "Email authentication is disabled. Connect a Solana wallet to sign in.",
  );

  return NextResponse.redirect(loginUrl);
}
