"use client";

import { CheckCircle2, ChevronDown, ExternalLink, Loader2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { WalletReadyState } from "@solana/wallet-adapter-base";

import { useWallet } from "@/components/wallet/fortis-wallet-provider";
import { shortenWalletAddress } from "@/lib/supabase/wallet-auth";
import { cn } from "@/lib/utils";

function getWalletStatusLabel(readyState: WalletReadyState) {
  switch (readyState) {
    case WalletReadyState.Installed:
      return "Detected";
    case WalletReadyState.Loadable:
      return "Connect";
    case WalletReadyState.NotDetected:
      return "Install";
    default:
      return "Unavailable";
  }
}

interface WalletButtonProps {
  className?: string;
}

export default function WalletButton({ className }: WalletButtonProps) {
  const { connected, connectWallet, connecting, disconnecting, publicKey, wallet, wallets } =
    useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingWalletName, setPendingWalletName] = useState<string | null>(null);

  const sortedWallets = useMemo(
    () =>
      [...wallets].sort((left, right) => {
        const leftInstalled = left.readyState === WalletReadyState.Installed ? 1 : 0;
        const rightInstalled = right.readyState === WalletReadyState.Installed ? 1 : 0;

        return rightInstalled - leftInstalled;
      }),
    [wallets],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const buttonLabel = connected && publicKey
    ? shortenWalletAddress(publicKey.toBase58())
    : connecting
      ? "Connecting..."
      : wallet?.adapter.name ?? "Select Wallet";

  async function handleWalletSelection(walletName: Parameters<typeof connectWallet>[0]) {
    setPendingWalletName(walletName);

    try {
      await connectWallet(walletName);
      setIsOpen(false);
    } finally {
      setPendingWalletName(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={connecting || disconnecting}
        className={cn(
          "flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        {connecting ? (
          <Loader2 className="h-4 w-4 animate-spin text-white/70" />
        ) : (
          <Wallet className="h-4 w-4 text-white/70" />
        )}
        <span>{buttonLabel}</span>
        <ChevronDown className="h-4 w-4 text-white/55" />
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close wallet picker"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          <div className="relative z-10 w-full max-w-md rounded-[1.8rem] border border-white/10 bg-[rgba(13,17,29,0.96)] p-5 shadow-[0_28px_90px_rgba(3,6,18,0.58)]">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-white/45">
                  Solana Wallet
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">Connect your wallet</h3>
              </div>

              {connected && publicKey ? (
                <div className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100">
                  {shortenWalletAddress(publicKey.toBase58())}
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              {sortedWallets.map(({ adapter, readyState }) => {
                const isPending = pendingWalletName === adapter.name;
                const canConnect =
                  readyState === WalletReadyState.Installed ||
                  readyState === WalletReadyState.Loadable;

                return (
                  <button
                    key={adapter.name}
                    type="button"
                    onClick={() => void handleWalletSelection(adapter.name)}
                    disabled={Boolean(pendingWalletName)}
                    className="flex w-full items-center gap-3 rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-white transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={adapter.icon}
                      alt=""
                      className="h-10 w-10 rounded-full border border-white/10 bg-white/10 p-1"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">
                          {adapter.name}
                        </span>
                        {wallet?.adapter.name === adapter.name && connected ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-white/45">
                        {getWalletStatusLabel(readyState)}
                      </p>
                    </div>

                    {isPending ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/70" />
                    ) : canConnect ? null : (
                      <ExternalLink className="h-4 w-4 shrink-0 text-white/45" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
