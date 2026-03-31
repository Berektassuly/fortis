import { unstable_noStore as noStore } from "next/cache";
import { LockKeyhole, Shield, Sparkles } from "lucide-react";
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

const featureCards = [
  {
    description:
      "Все операции защищены on-chain комплаенсом и криптографическими подписями.",
    icon: Shield,
    title: "Публикация активов",
  },
  {
    description:
      "Приватные транзакции через Jito-бандлы (Ghost Mode) и защита от MEV-атак.",
    icon: LockKeyhole,
    title: "Институциональная безопасность",
  },
] as const;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  noStore();

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
    <div className="min-h-screen bg-background">
      <Header />

      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[10%] top-20 h-80 w-80 rounded-full bg-neon-purple/20 blur-[120px]" />
          <div className="absolute right-[8%] top-28 h-96 w-96 rounded-full bg-neon-blue/15 blur-[140px]" />
          <div className="absolute bottom-10 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-[140px]" />
          <div className="absolute left-1/2 top-24 h-[420px] w-[420px] -translate-x-1/2 rotate-45 rounded-[4rem] border border-white/10 opacity-40 shadow-[0_0_90px_rgba(168,85,247,0.18)]" />
          <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
          <svg
            aria-hidden="true"
            viewBox="0 0 1600 420"
            className="absolute bottom-12 left-0 h-72 w-full opacity-35"
            fill="none"
            preserveAspectRatio="none"
          >
            {[0, 26, 52, 78, 104, 130].map((offset) => (
              <path
                key={offset}
                d={`M-80 ${250 - offset}C120 ${180 - offset}, 260 ${170 - offset}, 430 ${
                  218 - offset
                }S770 ${286 - offset}, 970 ${222 - offset}S1310 ${176 - offset}, 1680 ${240 - offset}`}
                stroke="rgba(143,111,255,0.22)"
                strokeWidth="2"
              />
            ))}
          </svg>
        </div>

        <div className="container relative mx-auto flex min-h-[calc(100vh-80px)] items-center px-4 py-10 lg:py-16">
          <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <section className="relative overflow-hidden rounded-[2.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(11,13,28,0.8),rgba(9,11,21,0.45))] px-6 py-8 shadow-[0_30px_120px_rgba(4,6,20,0.65)] sm:px-8 sm:py-10 lg:px-10 lg:py-12">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.07),transparent_48%)]" />
              <div className="absolute right-6 top-6 rounded-full border border-white/10 bg-white/5 p-3 text-neon-purple shadow-[0_0_28px_rgba(168,85,247,0.22)]">
                <Sparkles className="h-5 w-5" />
              </div>

              <div className="relative z-10 space-y-7">
                <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-primary">
                  Fortis Identity Layer
                </span>

                <div className="space-y-4">
                  <h1 className="neon-text max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-[3.7rem] lg:leading-[1.02]">
                    Вход в Fortis Marketplace
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-white/68 sm:text-lg">
                    Авторизуйтесь, чтобы получить доступ к институциональным
                    токенизированным активам, безопасно публиковать RWA-предложения и
                    управлять своим портфелем.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {featureCards.map((feature) => {
                    const Icon = feature.icon;

                    return (
                      <article
                        key={feature.title}
                        className="glass rounded-[1.8rem] border border-purple-500/30 bg-card/35 p-5 transition-all duration-300 hover:border-purple-500/60 hover:shadow-[0_0_30px_rgba(168,85,247,0.16)]"
                      >
                        <div className="mb-4 inline-flex rounded-2xl border border-white/10 bg-white/6 p-3 text-neon-purple">
                          <Icon className="h-5 w-5" />
                        </div>
                        <p className="text-sm font-semibold text-white">{feature.title}</p>
                        <p className="mt-2 text-sm leading-6 text-white/60">
                          {feature.description}
                        </p>
                      </article>
                    );
                  })}
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
        </div>
      </main>
    </div>
  );
}
