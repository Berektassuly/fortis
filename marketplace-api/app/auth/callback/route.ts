import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { syncSupabaseAuthUser } from "@/lib/services/users";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { applyRedirectTarget, getSafeRedirectPath } from "@/lib/supabase/redirects";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const next = getSafeRedirectPath(request.nextUrl.searchParams.get("next"), "/");
  const loginUrl = request.nextUrl.clone();

  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", next);

  if (!isSupabaseConfigured()) {
    loginUrl.searchParams.set(
      "error",
      "Supabase Auth не настроен для этого деплоя. Добавьте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY в Vercel.",
    );
    return NextResponse.redirect(loginUrl);
  }

  const supabase = createClient();
  const redirectUrl = applyRedirectTarget(request.nextUrl.clone(), next);
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const defaultErrorMessage = "Не удалось подтвердить вход. Попробуйте еще раз.";

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
