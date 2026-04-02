import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getOptionalSupabaseConfig } from "@/lib/supabase/config";
import { applyRedirectTarget, getSafeRedirectPath } from "@/lib/supabase/redirects";
import { extractWalletAddressFromSupabaseUser } from "@/lib/supabase/wallet-auth";

const PRIVATE_PATHS = ["/create"];
const AUTH_PATHS = ["/login"];

function matchesPath(pathname: string, candidates: string[]) {
  return candidates.some((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
}

export async function updateSession(request: NextRequest) {
  const supabaseConfig = getOptionalSupabaseConfig();
  const pathname = request.nextUrl.pathname;
  const isPrivatePath = matchesPath(pathname, PRIVATE_PATHS);

  if (!supabaseConfig) {
    if (!isPrivatePath) {
      return NextResponse.next({
        request,
      });
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", getSafeRedirectPath(pathname, "/create"));
    redirectUrl.searchParams.set(
      "error",
      "Supabase Auth не настроен для этого деплоя. Добавьте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY в Vercel.",
    );

    return NextResponse.redirect(redirectUrl);
  }

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseConfig.url, supabaseConfig.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user && extractWalletAddressFromSupabaseUser(user));
  const isAuthPath = matchesPath(pathname, AUTH_PATHS);

  if (!isAuthenticated && isPrivatePath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set(
      "next",
      getSafeRedirectPath(pathname, "/create"),
    );

    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthenticated && isAuthPath) {
    const redirectUrl = request.nextUrl.clone();
    applyRedirectTarget(redirectUrl, request.nextUrl.searchParams.get("next"), "/");
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
