"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";
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
  const currentWalletAddress = publicKey?.toBase58() ?? null;

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

  const title =
    currentWalletAddress
      ? `Подключен ${shortenAddress(currentWalletAddress)}`
      : profile?.solanaWalletAddress
        ? `Связан ${shortenAddress(profile.solanaWalletAddress)}`
        : "Подключите кошелек Solana";

  return (
    <div
      title={title}
      aria-busy={isBinding || isProfileLoading}
      className={isBinding || isProfileLoading ? "pointer-events-none opacity-75" : undefined}
    >
      <WalletMultiButton className="!h-11 !rounded-full !px-4 !text-sm !font-semibold" />
    </div>
  );
}
