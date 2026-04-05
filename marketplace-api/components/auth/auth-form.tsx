"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SolanaWallet } from "@supabase/auth-js";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { signInWithConnectedWallet } from "@/lib/supabase/web3-client";
import { shortenWalletAddress } from "@/lib/supabase/wallet-auth";
import { useWallet } from "@/components/wallet/fortis-wallet-provider";
import WalletButton from "@/components/wallet/wallet-button";

interface AuthFormProps {
  disabledReason?: string;
  initialError?: string;
  initialMessage?: string;
  nextPath: string;
}

function normalizeAuthMessage(message?: string) {
  if (!message) {
    return undefined;
  }

  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("user rejected")) {
    return "Подпись входа была отклонена в кошельке.";
  }

  if (normalizedMessage.includes("wallet") && normalizedMessage.includes("not connected")) {
    return "Сначала подключите Solana-кошелек.";
  }

  return message;
}

export default function AuthForm({
  disabledReason,
  initialError,
  initialMessage,
  nextPath,
}: AuthFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { publicKey, signIn, signMessage } = useWallet();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const attemptedWalletRef = useRef<string | null>(null);
  const connectedWalletAddress = publicKey?.toBase58() ?? null;
  const canSignInWithWallet = Boolean(connectedWalletAddress && (signIn || signMessage));
  const normalizedDisabledReason = normalizeAuthMessage(disabledReason);

  useEffect(() => {
    const errorMessage = normalizeAuthMessage(initialError);

    if (errorMessage) {
      toast.error(errorMessage);
    }

    if (initialMessage) {
      toast.success(initialMessage);
    }
  }, [initialError, initialMessage]);

  useEffect(() => {
    if (!connectedWalletAddress) {
      attemptedWalletRef.current = null;
    }
  }, [connectedWalletAddress]);

  const signInWithWallet = useCallback(async () => {
    if (normalizedDisabledReason) {
      toast.error(normalizedDisabledReason);
      return;
    }

    if (!connectedWalletAddress || !publicKey) {
      toast.error("Подключите Solana-кошелек перед входом.");
      return;
    }

    if (!signIn && !signMessage) {
      toast.error("Этот Solana-кошелек не поддерживает SIWS-подпись.");
      return;
    }

    try {
      setIsSigningIn(true);

      const result = await signInWithConnectedWallet({
        connectedWalletAddress,
        supabase,
        wallet: {
          publicKey,
          signIn: signIn as SolanaWallet["signIn"],
          signMessage,
        },
      });

      if (result.kind === "switched-wallet") {
        toast.success("Кошелек переключен. Сессия Fortis обновлена.");
      } else if (result.kind === "signed-in") {
        toast.success("Вход выполнен через Solana wallet.");
      }

      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(
        normalizeAuthMessage(error instanceof Error ? error.message : undefined) ??
          "Не удалось выполнить вход через Solana wallet.",
      );
    } finally {
      setIsSigningIn(false);
    }
  }, [
    connectedWalletAddress,
    nextPath,
    normalizedDisabledReason,
    publicKey,
    router,
    signIn,
    signMessage,
    supabase,
  ]);

  useEffect(() => {
    if (!canSignInWithWallet || normalizedDisabledReason) {
      return;
    }

    if (attemptedWalletRef.current === connectedWalletAddress) {
      return;
    }

    attemptedWalletRef.current = connectedWalletAddress;
    void signInWithWallet();
  }, [canSignInWithWallet, connectedWalletAddress, normalizedDisabledReason, signInWithWallet]);

  return (
    <section className="relative overflow-hidden rounded-[2.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,18,32,0.88),rgba(10,12,23,0.9))] p-6 shadow-[0_0_30px_rgba(168,85,247,0.15),0_24px_80px_rgba(3,6,20,0.6)] backdrop-blur-2xl sm:p-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_42%)]" />
      <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-neon-purple/12 blur-[90px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-neon-blue/10 blur-[90px]" />

      <div className="relative z-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70">
            <Wallet className="h-4 w-4 text-neon-blue" />
            Solana SIWS
          </div>

          <div className="rounded-full border border-white/10 bg-white/5 p-2.5 text-neon-purple">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>

        <div className="mb-6 space-y-2">
          <h2 className="text-2xl font-semibold text-white">Вход через кошелек</h2>
          <p className="text-sm leading-6 text-white/60">
            Fortis больше не использует email и пароль. Подключите Solana-кошелек и подпишите стандартное SIWS-сообщение, чтобы получить защищенную сессию.
          </p>
        </div>

        {normalizedDisabledReason ? (
          <div className="mb-5 rounded-[1.4rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-white">
            {normalizedDisabledReason}
          </div>
        ) : null}

        <div className="rounded-[1.8rem] border border-white/8 bg-white/5 p-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-[1.4rem] border border-white/8 bg-background/30 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/42">
                  Wallet Identity
                </p>
                <p className="mt-1 text-sm font-medium text-white">
                  {connectedWalletAddress
                    ? shortenWalletAddress(connectedWalletAddress)
                    : "Кошелек еще не подключен"}
                </p>
              </div>

              <WalletButton className="!h-11 !rounded-full !px-4 !text-sm !font-semibold" />
            </div>

            <div className="rounded-[1.4rem] border border-white/8 bg-white/5 px-4 py-4 text-sm leading-6 text-white/62">
              {connectedWalletAddress
                ? "После подключения Fortis автоматически запросит стандартную подпись Sign-In With Solana. Если подпись была отклонена, нажмите кнопку ниже и повторите попытку."
                : "Подключите поддерживаемый Solana-кошелек, чтобы Fortis выпустил Web3-сессию только для этой wallet identity."}
            </div>

            <button
              type="button"
              onClick={() => void signInWithWallet()}
              disabled={isSigningIn || !canSignInWithWallet || Boolean(normalizedDisabledReason)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:neon-glow disabled:opacity-50"
            >
              {isSigningIn ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Подпись SIWS...
                </>
              ) : canSignInWithWallet ? (
                "Подписать и войти"
              ) : (
                "Сначала подключите кошелек"
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
