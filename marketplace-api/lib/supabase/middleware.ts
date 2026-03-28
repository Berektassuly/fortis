import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/config";
import { applyRedirectTarget, getSafeRedirectPath } from "@/lib/supabase/redirects";

const PRIVATE_PATHS = ["/create"];
const AUTH_PATHS = ["/login"];

function matchesPath(pathname: string, candidates: string[]) {
  return candidates.some((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const pathname = request.nextUrl.pathname;
  const isAuthenticated = Boolean(claims?.sub);
  const isPrivatePath = matchesPath(pathname, PRIVATE_PATHS);
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
