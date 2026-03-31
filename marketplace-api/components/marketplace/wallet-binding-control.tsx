"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type WalletProfile = {
  email: string;
  id: number;
  solanaWalletAddress: string | null;
};

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

async function fetchWalletProfile() {
  const response = await fetch("/api/me/wallet", {
    cache: "no-store",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to load wallet profile.");
  }

  return (await response.json()) as WalletProfile;
}

async function bindWallet(walletAddress: string) {
  const response = await fetch("/api/me/wallet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      walletAddress,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to bind the connected wallet.");
  }

  return (await response.json()) as WalletProfile;
}

function shortenAddress(value: string | null | undefined) {
  if (!value) {
    return "Wallet not linked";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export default function WalletBindingControl() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isBinding, startTransition] = useTransition();
  const currentWalletAddress = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const displayWalletAddress = currentWalletAddress ?? profile?.solanaWalletAddress ?? null;

  useEffect(() => {
    let active = true;

    setIsProfileLoading(true);

    void fetchWalletProfile()
      .then((nextProfile) => {
        if (active) {
          setProfile(nextProfile);
        }
      })
      .catch((error) => {
        if (error instanceof Error) {
          console.error("Failed to load marketplace wallet profile", error);
        }
      })
      .finally(() => {
        if (active) {
          setIsProfileLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [connected]);

  useEffect(() => {
    if (!connected || !currentWalletAddress) {
      return;
    }

    if (!profile || isProfileLoading) {
      return;
    }

    if (profile.solanaWalletAddress === currentWalletAddress) {
      return;
    }

    startTransition(() => {
      void bindWallet(currentWalletAddress)
        .then((nextProfile) => {
          setProfile(nextProfile);
          router.refresh();
          toast.success("Wallet linked to your Fortis account.");
        })
        .catch((error) => {
          console.error(error);
          toast.error(error instanceof Error ? error.message : "Failed to bind wallet.");
        });
    });
  }, [connected, currentWalletAddress, isProfileLoading, profile, router]);

  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-3 py-2">
      <div className="hidden min-w-0 md:block">
        <p className="truncate text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Solana
        </p>
        <p className="truncate text-sm text-foreground">
          {displayWalletAddress ? shortenAddress(displayWalletAddress) : "Connect to link"}
        </p>
      </div>

      <div
        className={isBinding || isProfileLoading ? "pointer-events-none opacity-70" : undefined}
      >
        <WalletMultiButton className="!h-10 !rounded-2xl !bg-primary/90 !px-4 !text-sm !font-medium !text-primary-foreground hover:!bg-primary" />
      </div>
    </div>
  );
}
