import { redirect } from "next/navigation";

import AuthForm from "@/components/auth/auth-form";
import Header from "@/components/marketplace/header";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSafeRedirectPath } from "@/lib/supabase/redirects";
import { createClient } from "@/lib/supabase/server";

interface LoginPageProps {
  searchParams?: {
    email?: string;
    error?: string;
    message?: string;
    mode?: string;
    next?: string;
  };
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const nextPath = getSafeRedirectPath(searchParams?.next, "/");
  const supabaseConfigured = isSupabaseConfigured();
  const configError = !supabaseConfigured
    ? "Supabase Auth Ð½Ðµ Ð½Ð°ÑÑ‚Ñ€Ð¾ÐµÐ½ Ð´Ð»Ñ ÑÑ‚Ð¾Ð³Ð¾ Ð´ÐµÐ¿Ð»Ð¾Ñ. Ð”Ð¾Ð±Ð°Ð²ÑŒÑ‚Ðµ NEXT_PUBLIC_SUPABASE_URL Ð¸ NEXT_PUBLIC_SUPABASE_ANON_KEY Ð² Vercel."
    : undefined;

  if (supabaseConfigured) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect(nextPath);
    }
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto flex min-h-[calc(100vh-80px)] max-w-5xl items-center px-4 py-8">
        <div className="grid w-full gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-5">
            <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-primary">
              Supabase Auth
            </span>
            <div className="space-y-3">
              <h1 className="neon-text text-3xl font-bold md:text-5xl">Ð’Ñ…Ð¾Ð´ Ð² Fortis Marketplace</h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                ÐÐ²Ñ‚Ð¾Ñ€Ð¸Ð·ÑƒÐ¹Ñ‚ÐµÑÑŒ Ñ‡ÐµÑ€ÐµÐ· Supabase, Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð¿ÑƒÐ±Ð»Ð¸ÐºÐ¾Ð²Ð°Ñ‚ÑŒ Ð¾Ð±ÑŠÑÐ²Ð»ÐµÐ½Ð¸Ñ, Ð·Ð°Ð³Ñ€ÑƒÐ¶Ð°Ñ‚ÑŒ Ñ„Ð¾Ñ‚Ð¾ Ð² Storage Ð¸
                Ñ€Ð°Ð±Ð¾Ñ‚Ð°Ñ‚ÑŒ Ñ marketplace-Ð´Ð°Ð½Ð½Ñ‹Ð¼Ð¸ Ñ‡ÐµÑ€ÐµÐ· Supabase Ð¸ Ð½Ð°Ñ‚Ð¸Ð²Ð½Ñ‹Ð¹ PostgreSQL.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="glass rounded-3xl border border-border/40 p-5">
                <p className="text-sm font-medium text-foreground">ÐŸÑƒÐ±Ð»Ð¸ÐºÐ°Ñ†Ð¸Ñ Ð¾Ð±ÑŠÑÐ²Ð»ÐµÐ½Ð¸Ð¹</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  ÐœÐ°Ñ€ÑˆÑ€ÑƒÑ‚ <code>/create</code> Ñ‚ÐµÐ¿ÐµÑ€ÑŒ Ð·Ð°Ñ‰Ð¸Ñ‰ÐµÐ½ middleware Ð¸ Ñ€Ð°Ð±Ð¾Ñ‚Ð°ÐµÑ‚ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð´Ð»Ñ
                  Ð°Ð²Ñ‚Ð¾Ñ€Ð¸Ð·Ð¾Ð²Ð°Ð½Ð½Ñ‹Ñ… Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»ÐµÐ¹.
                </p>
              </div>
              <div className="glass rounded-3xl border border-border/40 p-5">
                <p className="text-sm font-medium text-foreground">Ð”Ð¾Ð»Ð³Ð¾Ð²ÐµÑ‡Ð½Ñ‹Ðµ Ð¸Ð·Ð¾Ð±Ñ€Ð°Ð¶ÐµÐ½Ð¸Ñ</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Ð¤Ð¾Ñ‚Ð¾Ð³Ñ€Ð°Ñ„Ð¸Ð¸ Ð¾Ñ‚Ð¿Ñ€Ð°Ð²Ð»ÑÑŽÑ‚ÑÑ Ð² Ð¿ÑƒÐ±Ð»Ð¸Ñ‡Ð½Ñ‹Ð¹ bucket <code>listings</code> Ð²Ð¼ÐµÑÑ‚Ð¾ Ð²Ñ€ÐµÐ¼ÐµÐ½Ð½Ñ‹Ñ…{" "}
                  <code>blob:</code> URL.
                </p>
              </div>
            </div>
          </section>

          <AuthForm
            nextPath={nextPath}
            initialEmail={searchParams?.email}
            initialMode={searchParams?.mode === "signup" ? "signup" : "login"}
            initialError={searchParams?.error ?? configError}
            initialMessage={searchParams?.message}
            disabledReason={configError}
          />
        </div>
      </main>
    </div>
  );
}
