import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { syncSupabaseAuthUser } from "@/lib/services/users";
import { applyRedirectTarget, getSafeRedirectPath } from "@/lib/supabase/redirects";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const next = getSafeRedirectPath(request.nextUrl.searchParams.get("next"), "/");
  const redirectUrl = applyRedirectTarget(request.nextUrl.clone(), next);
  const loginUrl = request.nextUrl.clone();
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const defaultErrorMessage = "Не удалось подтвердить вход. Попробуйте еще раз.";

  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", next);

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      loginUrl.searchParams.set("error", error.message);
      return NextResponse.redirect(loginUrl);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (error) {
      loginUrl.searchParams.set("error", error.message);
      return NextResponse.redirect(loginUrl);
    }
  } else {
    loginUrl.searchParams.set("error", defaultErrorMessage);
    return NextResponse.redirect(loginUrl);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await syncSupabaseAuthUser(user);
  }

  return NextResponse.redirect(redirectUrl);
}
