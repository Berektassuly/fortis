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
    ? "Supabase Auth не настроен для этого деплоя. Добавьте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY в Vercel."
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
              <h1 className="neon-text text-3xl font-bold md:text-5xl">Вход в Fortis Marketplace</h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                Авторизуйтесь через Supabase, чтобы публиковать объявления, загружать фото в Storage и
                создавать записи от имени реального пользователя Prisma.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="glass rounded-3xl border border-border/40 p-5">
                <p className="text-sm font-medium text-foreground">Публикация объявлений</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Маршрут <code>/create</code> теперь защищен middleware и работает только для
                  авторизованных пользователей.
                </p>
              </div>
              <div className="glass rounded-3xl border border-border/40 p-5">
                <p className="text-sm font-medium text-foreground">Долговечные изображения</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Фотографии отправляются в публичный bucket <code>listings</code> вместо временных{" "}
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
