import Link from "next/link";
import { Home, LogIn, Plus, Search } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export default async function Header() {
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
    <header className="glass sticky top-0 z-50 border-b border-border/30">
      <div className="container mx-auto flex items-center justify-between px-4 py-3">
        <Link href="/" className="group flex items-center gap-2">
          <Home className="h-6 w-6 text-neon-purple transition-all group-hover:drop-shadow-[0_0_8px_hsl(250,90%,65%)]" />
          <span className="neon-text text-xl font-bold">НеоДом</span>
        </Link>

        <div className="glass hidden w-96 items-center gap-2 rounded-2xl px-4 py-2 md:flex">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Поиск недвижимости..."
            readOnly
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex items-center gap-2">
          {!supabaseConfigured ? (
            <span className="glass rounded-2xl px-4 py-2.5 text-sm text-muted-foreground">
              Auth unavailable
            </span>
          ) : userEmail ? (
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="glass flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <span className="hidden max-w-40 truncate md:inline">{userEmail}</span>
                <span>Выйти</span>
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="glass flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <LogIn className="h-4 w-4" />
              Войти
            </Link>
          )}

          <Link
            href={createHref}
            className="flex items-center gap-2 rounded-2xl bg-primary/90 px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all duration-300 hover:bg-primary hover:neon-glow"
          >
            <Plus className="h-4 w-4" />
            Подать объявление
          </Link>
        </div>
      </div>
    </header>
  );
}
