"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
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

function normalizeAuthMessage(message?: string) {
  if (!message) {
    return undefined;
  }

  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("invalid login credentials")) {
    return "Неверный email или пароль.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "Подтвердите email, чтобы войти в аккаунт.";
  }

  if (normalizedMessage.includes("user already registered")) {
    return "Аккаунт с таким email уже существует. Попробуйте войти.";
  }

  if (normalizedMessage.includes("signup is disabled")) {
    return "Регистрация временно недоступна.";
  }

  return message;
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
    const errorMessage = normalizeAuthMessage(initialError);

    if (errorMessage) {
      toast.error(errorMessage);
    }

    if (initialMessage) {
      toast.success(initialMessage);
    }
  }, [initialError, initialMessage]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const blockedReason = normalizeAuthMessage(disabledReason);

    if (blockedReason) {
      toast.error(blockedReason);
      return;
    }

    if (!email.trim() || !password.trim()) {
      toast.error("Введите email и пароль.");
      return;
    }

    if (mode === "signup" && password.length < 6) {
      toast.error("Пароль должен содержать минимум 6 символов.");
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

        toast.success("Вы вошли в аккаунт.");
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
        toast.success("Аккаунт создан, вход выполнен автоматически.");
        router.replace(nextPath);
        router.refresh();
        return;
      }

      setMode("login");
      setPassword("");
      toast.success("Проверьте почту и подтвердите регистрацию по ссылке из письма.");
    } catch (error) {
      console.error(error);
      toast.error(
        normalizeAuthMessage(error instanceof Error ? error.message : undefined) ??
          "Не удалось выполнить авторизацию.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-2xl border border-white/10 bg-background/80 px-4 py-3.5 text-sm text-white outline-none transition-all placeholder:text-white/28 focus:border-neon-purple focus:ring-2 focus:ring-neon-purple/40";
  const normalizedDisabledReason = normalizeAuthMessage(disabledReason);

  return (
    <section className="relative overflow-hidden rounded-[2.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,18,32,0.88),rgba(10,12,23,0.9))] p-6 shadow-[0_0_30px_rgba(168,85,247,0.15),0_24px_80px_rgba(3,6,20,0.6)] backdrop-blur-2xl sm:p-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_42%)]" />
      <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-neon-purple/12 blur-[90px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-neon-blue/10 blur-[90px]" />

      <div className="relative z-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={[
                "rounded-full px-4 py-2 text-sm font-medium transition-all duration-300",
                mode === "login"
                  ? "bg-primary text-primary-foreground shadow-[0_0_18px_rgba(168,85,247,0.35)]"
                  : "text-white/58 hover:text-white",
              ].join(" ")}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={[
                "rounded-full px-4 py-2 text-sm font-medium transition-all duration-300",
                mode === "signup"
                  ? "bg-primary text-primary-foreground shadow-[0_0_18px_rgba(168,85,247,0.35)]"
                  : "text-white/58 hover:text-white",
              ].join(" ")}
            >
              Регистрация
            </button>
          </div>

          <div className="rounded-full border border-white/10 bg-white/5 p-2.5 text-neon-purple">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>

        <div className="mb-6 space-y-2">
          <h2 className="text-2xl font-semibold text-white">
            {mode === "login" ? "Вход" : "Регистрация"}
          </h2>
          <p className="text-sm leading-6 text-white/60">
            {mode === "login"
              ? "Войдите, чтобы получить доступ к торговой платформе."
              : "Создайте аккаунт для доступа к маркетплейсу."}
          </p>
        </div>

        {normalizedDisabledReason ? (
          <div className="mb-5 rounded-[1.4rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-white">
            {normalizedDisabledReason}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-white/80">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={`${inputClass} pl-11`}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={Boolean(normalizedDisabledReason)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-white/80">
              Пароль
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`${inputClass} pl-11`}
                placeholder="Минимум 6 символов"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={6}
                disabled={Boolean(normalizedDisabledReason)}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || Boolean(normalizedDisabledReason)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:neon-glow disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {mode === "login" ? "Вход..." : "Создание аккаунта..."}
              </>
            ) : mode === "login" ? (
              "Войти"
            ) : (
              "Создать аккаунт"
            )}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between gap-4 rounded-[1.2rem] border border-white/8 bg-white/5 px-4 py-3 text-sm text-white/56">
          <span>{mode === "login" ? "Нет аккаунта?" : "Уже есть аккаунт?"}</span>
          <button
            type="button"
            onClick={() => setMode((current) => (current === "login" ? "signup" : "login"))}
            className="font-medium text-primary transition-colors hover:text-primary/80"
          >
            {mode === "login" ? "Регистрация" : "Войти"}
          </button>
        </div>
      </div>
    </section>
  );
}
