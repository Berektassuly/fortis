import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(
      new URL("/login?error=Supabase%20Auth%20is%20not%20configured.", request.url),
    );
  }

  const supabase = createClient();

  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", request.url));
}
