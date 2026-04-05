"use client";

import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from "react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { ConnectionProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";
import { ThemeProvider } from "next-themes";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { FortisWalletProvider } from "@/components/wallet/fortis-wallet-provider";

interface StableConnectionProviderProps {
  children: ReactNode;
  endpoint: string;
}

const StableConnectionProvider =
  ConnectionProvider as unknown as ComponentType<StableConnectionProviderProps>;

function getWalletErrorMessage(error: Error, adapter?: Adapter) {
  const normalizedMessage = error.message.trim().toLowerCase();

  if (normalizedMessage === "unexpected error") {
    return `${adapter?.name ?? "The selected wallet"} failed the connection request unexpectedly. Reopen the wallet and try again.`;
  }

  if (normalizedMessage.includes("wallet not ready")) {
    return `${adapter?.name ?? "The selected wallet"} is not available in this browser yet. Install or unlock it, then try again.`;
  }

  if (normalizedMessage.includes("user rejected")) {
    return "The wallet connection request was rejected.";
  }

  return error.message || "Failed to connect the selected Solana wallet.";
}

export function Providers({ children }: { children: ReactNode }) {
  const network = WalletAdapterNetwork.Devnet;
  const [mounted, setMounted] = useState(false);
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || clusterApiUrl(network),
    [network],
  );
  const wallets = useMemo(
    () => (mounted ? [new PhantomWalletAdapter(), new SolflareWalletAdapter()] : []),
    [mounted],
  );
  const handleWalletError = (error: Error, adapter?: Adapter) => {
    console.error("Solana wallet adapter error", error);
    toast.error(getWalletErrorMessage(error, adapter));
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <StableConnectionProvider endpoint={endpoint}>
        <FortisWalletProvider wallets={wallets} onError={handleWalletError}>
          {children}
          <Toaster position="top-right" richColors />
        </FortisWalletProvider>
      </StableConnectionProvider>
    </ThemeProvider>
  );
}
