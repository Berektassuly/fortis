"use client";

import { type ComponentType, type ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";

interface StableConnectionProviderProps {
  children: ReactNode;
  endpoint: string;
}

interface StableWalletProviderProps {
  autoConnect?: boolean;
  children: ReactNode;
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

export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || clusterApiUrl(WalletAdapterNetwork.Devnet);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <StableConnectionProvider endpoint={endpoint}>
        <StableWalletProvider wallets={wallets} autoConnect>
          <StableWalletModalProvider>
            {children}
            <Toaster position="top-right" richColors />
          </StableWalletModalProvider>
        </StableWalletProvider>
      </StableConnectionProvider>
    </ThemeProvider>
  );
}
