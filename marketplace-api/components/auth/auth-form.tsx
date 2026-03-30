"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  disabledReason?: string;
  initialEmail?: string;
  initialError?: string;
  initialMessage?: string;
  initialMode: AuthMode;
  nextPath: string;
}

export default function AuthForm({
  disabledReason,
  initialEmail,
  initialError,
  initialMessage,
  initialMode,
  nextPath,
}: AuthFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialError) {
      toast.error(initialError);
    }

    if (initialMessage) {
      toast.success(initialMessage);
    }
  }, [initialError, initialMessage]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }

    if (!email.trim() || !password.trim()) {
      toast.error("Ð’Ð²ÐµÐ´Ð¸Ñ‚Ðµ email Ð¸ Ð¿Ð°Ñ€Ð¾Ð»ÑŒ.");
      return;
    }

    if (mode === "signup" && password.length < 6) {
      toast.error("ÐŸÐ°Ñ€Ð¾Ð»ÑŒ Ð´Ð¾Ð»Ð¶ÐµÐ½ ÑÐ¾Ð´ÐµÑ€Ð¶Ð°Ñ‚ÑŒ Ð¼Ð¸Ð½Ð¸Ð¼ÑƒÐ¼ 6 ÑÐ¸Ð¼Ð²Ð¾Ð»Ð¾Ð².");
      return;
    }

    try {
      setIsSubmitting(true);

      const supabase = createClient();

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          throw error;
        }

        toast.success("Ð’Ñ‹ Ð²Ð¾ÑˆÐ»Ð¸ Ð² Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚.");
        router.replace(nextPath);
        router.refresh();
        return;
      }

      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", nextPath);

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: callbackUrl.toString(),
        },
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        toast.success("ÐÐºÐºÐ°ÑƒÐ½Ñ‚ ÑÐ¾Ð·Ð´Ð°Ð½, Ð²Ñ…Ð¾Ð´ Ð²Ñ‹Ð¿Ð¾Ð»Ð½ÐµÐ½ Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ñ‡ÐµÑÐºÐ¸.");
        router.replace(nextPath);
        router.refresh();
        return;
      }

      setMode("login");
      setPassword("");
      toast.success("ÐŸÑ€Ð¾Ð²ÐµÑ€ÑŒÑ‚Ðµ Ð¿Ð¾Ñ‡Ñ‚Ñƒ Ð¸ Ð¿Ð¾Ð´Ñ‚Ð²ÐµÑ€Ð´Ð¸Ñ‚Ðµ Ñ€ÐµÐ³Ð¸ÑÑ‚Ñ€Ð°Ñ†Ð¸ÑŽ Ð¿Ð¾ ÑÑÑ‹Ð»ÐºÐµ Ð¸Ð· Ð¿Ð¸ÑÑŒÐ¼Ð°.");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð²Ñ‹Ð¿Ð¾Ð»Ð½Ð¸Ñ‚ÑŒ Ð°Ð²Ñ‚Ð¾Ñ€Ð¸Ð·Ð°Ñ†Ð¸ÑŽ.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-2xl border border-border/40 bg-background/50 px-4 py-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/30";

  return (
    <section className="glass rounded-[2rem] border border-border/40 p-6 shadow-2xl shadow-background/30">
      <div className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold text-foreground">
          {mode === "login" ? "Ð’Ñ…Ð¾Ð´" : "Ð ÐµÐ³Ð¸ÑÑ‚Ñ€Ð°Ñ†Ð¸Ñ"}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {mode === "login"
            ? "Ð’Ð¾Ð¹Ð´Ð¸Ñ‚Ðµ, Ñ‡Ñ‚Ð¾Ð±Ñ‹ ÑÐ¾Ð·Ð´Ð°Ð²Ð°Ñ‚ÑŒ Ð¾Ð±ÑŠÑÐ²Ð»ÐµÐ½Ð¸Ñ Ð¸ Ð·Ð°Ð³Ñ€ÑƒÐ¶Ð°Ñ‚ÑŒ Ð¸Ð·Ð¾Ð±Ñ€Ð°Ð¶ÐµÐ½Ð¸Ñ Ð² Supabase Storage."
            : "Ð¡Ð¾Ð·Ð´Ð°Ð¹Ñ‚Ðµ Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚ Ð¿Ð¾ email Ð¸ Ð¿Ð°Ñ€Ð¾Ð»ÑŽ. ÐŸÑ€Ð¾Ñ„Ð¸Ð»ÑŒ marketplace Ð±ÑƒÐ´ÐµÑ‚ ÑÐ¾Ð·Ð´Ð°Ð½ Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ñ‡ÐµÑÐºÐ¸ Ð½Ð° ÑÑ‚Ð¾Ñ€Ð¾Ð½Ðµ Postgres."}
        </p>
      </div>

      {disabledReason ? (
        <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-foreground">
          {disabledReason}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={Boolean(disabledReason)}
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            ÐŸÐ°Ñ€Ð¾Ð»ÑŒ
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            placeholder="ÐœÐ¸Ð½Ð¸Ð¼ÑƒÐ¼ 6 ÑÐ¸Ð¼Ð²Ð¾Ð»Ð¾Ð²"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            disabled={Boolean(disabledReason)}
            required
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || Boolean(disabledReason)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/85 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {mode === "login" ? "Ð’Ñ…Ð¾Ð´..." : "Ð¡Ð¾Ð·Ð´Ð°Ð½Ð¸Ðµ Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚Ð°..."}
            </>
          ) : mode === "login" ? (
            "Ð’Ð¾Ð¹Ñ‚Ð¸"
          ) : (
            "Ð¡Ð¾Ð·Ð´Ð°Ñ‚ÑŒ Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚"
          )}
        </button>
      </form>

      <div className="mt-5 flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <span>{mode === "login" ? "ÐÐµÑ‚ Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚Ð°?" : "Ð£Ð¶Ðµ ÐµÑÑ‚ÑŒ Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚?"}</span>
        <button
          type="button"
          onClick={() => setMode((current) => (current === "login" ? "signup" : "login"))}
          className="font-medium text-primary transition-colors hover:text-primary/80"
        >
          {mode === "login" ? "Ð ÐµÐ³Ð¸ÑÑ‚Ñ€Ð°Ñ†Ð¸Ñ" : "Ð’Ð¾Ð¹Ñ‚Ð¸"}
        </button>
      </div>
    </section>
  );
}
