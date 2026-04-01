import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { ChevronDown, CircleUserRound, Plus, Search } from "lucide-react";

import WalletBindingControl from "@/components/marketplace/wallet-binding-control";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

function FortisLogo() {
  return (
    <div className="flex items-center gap-3">
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M7 4.5V27.5" stroke="#00E5FF" strokeWidth="3.25" strokeLinecap="round" />
        <path d="M7 6H24.5" stroke="#00E5FF" strokeWidth="3.25" strokeLinecap="round" />
        <path d="M7 16H21" stroke="#8B5CF6" strokeWidth="3.25" strokeLinecap="round" />
      </svg>

      <span className="text-[1.35rem] font-extrabold tracking-[-0.03em] text-white">
        Fortis
      </span>
    </div>
  );
}

export default async function Header() {
  noStore();

  const supabaseConfigured = isSupabaseConfigured();
  let userEmail: string | undefined;

  if (supabaseConfigured) {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      userEmail = user?.email;
    } catch (error) {
      console.error("Failed to resolve Supabase user in header", error);
    }
  }

  const createHref = supabaseConfigured
    ? userEmail
      ? "/create"
      : "/login?next=/create"
    : "/login?error=Supabase%20Auth%20is%20not%20configured%20for%20this%20deployment.";

  return (
    <header className="sticky top-0 z-50">
      <div className="mx-auto max-w-[1440px] px-4 pb-0 pt-0 sm:px-6 lg:px-8">
        <div className="rounded-[2rem] border border-white/10 bg-[rgba(11,13,23,0.78)] px-4 py-4 shadow-[0_22px_90px_rgba(3,6,18,0.45)] backdrop-blur-[28px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Link href="/" className="shrink-0">
                <FortisLogo />
              </Link>

              <div className="hidden min-w-0 flex-1 items-center gap-3 rounded-full border border-white/10 bg-[#111624]/85 px-5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:flex">
                <Search className="h-4 w-4 shrink-0 text-white/42" />
                <input
                  type="text"
                  placeholder="Поиск активов, эмитентов и регионов"
                  readOnly
                  className="min-w-0 flex-1 bg-transparent text-sm text-white/78 outline-none placeholder:text-white/38"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 sm:gap-3">
              <div className="hidden items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:flex">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(74,222,128,0.95)]" />
                </span>
                <span>Solana Mainnet</span>
              </div>

              <WalletBindingControl />

              {!supabaseConfigured ? (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/52">
                  Auth unavailable
                </span>
              ) : userEmail ? (
                <details className="group relative">
                  <summary className="flex list-none cursor-pointer items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.08]">
                    <CircleUserRound className="h-4 w-4 text-white/70" />
                    <span className="hidden max-w-[10rem] truncate sm:inline">{userEmail}</span>
                    <ChevronDown className="h-4 w-4 text-white/55 transition-transform group-open:rotate-180" />
                  </summary>

                  <div className="absolute right-0 top-[calc(100%+0.75rem)] w-[260px] rounded-[1.5rem] border border-white/10 bg-[rgba(14,18,31,0.96)] p-4 shadow-[0_22px_60px_rgba(4,8,20,0.55)] backdrop-blur-[26px]">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                      Аккаунт
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">{userEmail}</p>

                    <form action="/auth/sign-out" method="post" className="mt-4">
                      <button
                        type="submit"
                        className="w-full rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.08]"
                      >
                        Выйти
                      </button>
                    </form>
                  </div>
                </details>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.08]"
                >
                  <CircleUserRound className="h-4 w-4 text-white/70" />
                  Войти
                </Link>
              )}

              <Link
                href={createHref}
                className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.09] px-5 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all duration-200 hover:bg-white/[0.14] hover:shadow-[0_0_26px_rgba(255,255,255,0.08)]"
              >
                <Plus className="h-4 w-4" />
                Подать объявление
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
