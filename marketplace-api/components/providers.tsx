"use client";

import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from "react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";
import { ThemeProvider } from "next-themes";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";

interface StableConnectionProviderProps {
  children: ReactNode;
  endpoint: string;
}

interface StableWalletProviderProps {
  autoConnect?: boolean;
  children: ReactNode;
  onError?: (error: Error) => void;
  wallets: readonly unknown[];
}

interface StableWalletModalProviderProps {
  children: ReactNode;
}

const StableConnectionProvider =
  ConnectionProvider as unknown as ComponentType<StableConnectionProviderProps>;
const StableWalletProvider =
  WalletProvider as unknown as ComponentType<StableWalletProviderProps>;
const StableWalletModalProvider =
  WalletModalProvider as unknown as ComponentType<StableWalletModalProviderProps>;

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
  const handleWalletError = (error: Error) => {
    console.error("Solana wallet adapter error", error);
    toast.error(error.message || "Failed to connect the selected Solana wallet.");
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <StableConnectionProvider endpoint={endpoint}>
        <StableWalletProvider wallets={wallets} autoConnect={false} onError={handleWalletError}>
          <StableWalletModalProvider>
            {children}
            <Toaster position="top-right" richColors />
          </StableWalletModalProvider>
        </StableWalletProvider>
      </StableConnectionProvider>
    </ThemeProvider>
  );
}
