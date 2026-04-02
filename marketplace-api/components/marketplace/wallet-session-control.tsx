"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleUserRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import type { SolanaWallet } from "@supabase/auth-js";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { fetchCurrentWalletProfile, type WalletProfile } from "@/lib/supabase/wallet-profile";
import { signInWithConnectedWallet } from "@/lib/supabase/web3-client";
import {
  extractWalletAddressFromSupabaseUser,
  shortenWalletAddress,
} from "@/lib/supabase/wallet-auth";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

export default function WalletSessionControl() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { disconnect, publicKey, signIn, signMessage } = useWallet();
  const [isResolvingSession, setIsResolvingSession] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [sessionWalletAddress, setSessionWalletAddress] = useState<string | null>(null);
  const connectedWalletAddress = publicKey?.toBase58() ?? null;
  const canSignInWithWallet = Boolean(connectedWalletAddress && (signIn || signMessage));

  const refreshWalletSession = useCallback(async (nextSessionWalletAddress: string | null) => {
    if (!nextSessionWalletAddress) {
      setProfile(null);
      setIsResolvingSession(false);
      return;
    }

    try {
      setProfile(await fetchCurrentWalletProfile());
    } catch (error) {
      console.error("Failed to load the Fortis wallet profile", error);
    } finally {
      setIsResolvingSession(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadInitialSession() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) {
        return;
      }

      const nextSessionWalletAddress = extractWalletAddressFromSupabaseUser(user);
      setSessionWalletAddress(nextSessionWalletAddress);
      await refreshWalletSession(nextSessionWalletAddress);
    }

    void loadInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextSessionWalletAddress = extractWalletAddressFromSupabaseUser(session?.user ?? null);
      setSessionWalletAddress(nextSessionWalletAddress);
      void refreshWalletSession(nextSessionWalletAddress);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [refreshWalletSession, supabase]);

  const handleSignIn = useCallback(async () => {
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

      setSessionWalletAddress(result.walletAddress);
      await refreshWalletSession(result.walletAddress);

      if (result.kind === "switched-wallet") {
        toast.success("Сессия Fortis переключена на подключенный кошелек.");
      } else if (result.kind === "signed-in") {
        toast.success("Вход выполнен через Solana wallet.");
      }

      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Не удалось выполнить вход через кошелек.",
      );
    } finally {
      setIsSigningIn(false);
    }
  }, [
    connectedWalletAddress,
    publicKey,
    refreshWalletSession,
    router,
    signIn,
    signMessage,
    supabase,
  ]);

  const handleSignOut = useCallback(async () => {
    try {
      setIsSigningOut(true);

      try {
        await disconnect?.();
      } catch (error) {
        console.error("Failed to disconnect the active wallet", error);
      }

      const response = await fetch("/auth/sign-out", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Не удалось завершить текущую Fortis сессию.");
      }

      setProfile(null);
      setSessionWalletAddress(null);
      router.replace("/login");
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Не удалось выйти из Fortis.");
    } finally {
      setIsSigningOut(false);
    }
  }, [disconnect, router]);

  const hasWalletMismatch =
    Boolean(connectedWalletAddress) &&
    Boolean(sessionWalletAddress) &&
    connectedWalletAddress !== sessionWalletAddress;

  return (
    <div className="flex items-center gap-3">
      <WalletMultiButton className="!h-11 !rounded-full !px-4 !text-sm !font-semibold" />

      {sessionWalletAddress ? (
        <details className="group relative">
          <summary className="flex list-none cursor-pointer items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.08]">
            <CircleUserRound className="h-4 w-4 text-white/70" />
            <span className="hidden max-w-[10rem] truncate sm:inline">
              {shortenWalletAddress(profile?.solanaWalletAddress ?? sessionWalletAddress)}
            </span>
            {(isSigningOut || isResolvingSession) ? (
              <Loader2 className="h-4 w-4 animate-spin text-white/55" />
            ) : (
              <ChevronDown className="h-4 w-4 text-white/55 transition-transform group-open:rotate-180" />
            )}
          </summary>

          <div className="absolute right-0 top-[calc(100%+0.75rem)] w-[300px] rounded-[1.5rem] border border-white/10 bg-[rgba(14,18,31,0.96)] p-4 shadow-[0_22px_60px_rgba(4,8,20,0.55)] backdrop-blur-[26px]">
            <p className="text-[11px] uppercase tracking-[0.22em] text-white/42">
              Wallet Session
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-white">
              {profile?.solanaWalletAddress ?? sessionWalletAddress}
            </p>

            {hasWalletMismatch ? (
              <div className="mt-4 rounded-[1rem] border border-amber-300/20 bg-amber-500/10 px-3 py-3 text-sm leading-6 text-white/75">
                Подключен другой кошелек: {shortenWalletAddress(connectedWalletAddress)}. Выполните вход повторно, чтобы переключить Fortis identity.
              </div>
            ) : null}

            {connectedWalletAddress && connectedWalletAddress !== sessionWalletAddress ? (
              <button
                type="button"
                onClick={() => void handleSignIn()}
                disabled={isSigningIn || !canSignInWithWallet}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.08] disabled:opacity-60"
              >
                {isSigningIn ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Переключение...
                  </>
                ) : (
                  "Войти с подключенным кошельком"
                )}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="mt-4 w-full rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.08] disabled:opacity-60"
            >
              {isSigningOut ? "Выход..." : "Выйти"}
            </button>
          </div>
        </details>
      ) : connectedWalletAddress ? (
        <button
          type="button"
          onClick={() => void handleSignIn()}
          disabled={isSigningIn || !canSignInWithWallet}
          className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.08] disabled:opacity-60"
        >
          {isSigningIn ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-white/70" />
              Подпись SIWS...
            </>
          ) : (
            <>
              <CircleUserRound className="h-4 w-4 text-white/70" />
              Войти
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
