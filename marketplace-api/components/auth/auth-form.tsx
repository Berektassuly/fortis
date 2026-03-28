"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  initialEmail?: string;
  initialError?: string;
  initialMessage?: string;
  initialMode: AuthMode;
  nextPath: string;
}

async function syncCurrentUser() {
  const response = await fetch("/api/auth/sync-user", {
    method: "POST",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Не удалось подготовить профиль пользователя.");
  }
}

export default function AuthForm({
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

        await syncCurrentUser();
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
        await syncCurrentUser();
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
      toast.error(error instanceof Error ? error.message : "Не удалось выполнить авторизацию.");
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
          {mode === "login" ? "Вход" : "Регистрация"}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {mode === "login"
            ? "Войдите, чтобы создавать объявления и загружать изображения в Supabase Storage."
            : "Создайте аккаунт по email и паролю. После регистрации мы свяжем Supabase-пользователя с Prisma."}
        </p>
      </div>

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
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Пароль
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            placeholder="Минимум 6 символов"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            required
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/85 disabled:opacity-50"
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

      <div className="mt-5 flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <span>{mode === "login" ? "Нет аккаунта?" : "Уже есть аккаунт?"}</span>
        <button
          type="button"
          onClick={() => setMode((current) => (current === "login" ? "signup" : "login"))}
          className="font-medium text-primary transition-colors hover:text-primary/80"
        >
          {mode === "login" ? "Регистрация" : "Войти"}
        </button>
      </div>
    </section>
  );
}
