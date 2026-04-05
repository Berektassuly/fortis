"use client";

import {
  type Adapter,
  type MessageSignerWalletAdapterProps,
  type SignInMessageSignerWalletAdapterProps,
  type WalletName,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import type { PublicKey } from "@solana/web3.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type FortisWallet = {
  adapter: Adapter;
  readyState: WalletReadyState;
};

type FortisWalletContextValue = {
  wallets: FortisWallet[];
  wallet: FortisWallet | null;
  publicKey: PublicKey | null;
  connecting: boolean;
  connected: boolean;
  disconnecting: boolean;
  connectWallet(walletName: WalletName): Promise<void>;
  disconnect(): Promise<void>;
  signIn: SignInMessageSignerWalletAdapterProps["signIn"] | undefined;
  signMessage: MessageSignerWalletAdapterProps["signMessage"] | undefined;
};

const DEFAULT_CONTEXT: FortisWalletContextValue = {
  wallets: [],
  wallet: null,
  publicKey: null,
  connecting: false,
  connected: false,
  disconnecting: false,
  async connectWallet() {
    throw new Error("Wallet provider is missing.");
  },
  async disconnect() {
    throw new Error("Wallet provider is missing.");
  },
  signIn: undefined,
  signMessage: undefined,
};

const FortisWalletContext = createContext<FortisWalletContextValue>(DEFAULT_CONTEXT);

function isSelectableWallet(readyState: WalletReadyState) {
  return readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable;
}

function normalizeWallets(adapters: readonly Adapter[]) {
  return adapters
    .map((adapter) => ({
      adapter,
      readyState: adapter.readyState,
    }))
    .filter(({ readyState }) => readyState !== WalletReadyState.Unsupported);
}

interface FortisWalletProviderProps {
  children: ReactNode;
  onError?: (error: Error, adapter?: Adapter) => void;
  wallets: readonly Adapter[];
}

export function FortisWalletProvider({
  children,
  onError,
  wallets: adapters,
}: FortisWalletProviderProps) {
  const [wallets, setWallets] = useState(() => normalizeWallets(adapters));
  const [activeWalletName, setActiveWalletName] = useState<WalletName | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const connectedAdapterRef = useRef<Adapter | null>(null);
  const lastReportedErrorRef = useRef<Error | null>(null);

  const reportError = useCallback(
    (error: Error, adapter?: Adapter) => {
      if (lastReportedErrorRef.current === error) {
        return;
      }

      lastReportedErrorRef.current = error;
      queueMicrotask(() => {
        if (lastReportedErrorRef.current === error) {
          lastReportedErrorRef.current = null;
        }
      });

      onError?.(error, adapter);
    },
    [onError],
  );

  useEffect(() => {
    setWallets(normalizeWallets(adapters));

    function handleReadyStateChange(this: Adapter, readyState: WalletReadyState) {
      setWallets((currentWallets) =>
        currentWallets
          .map((wallet) =>
            wallet.adapter === this
              ? {
                  adapter: wallet.adapter,
                  readyState,
                }
              : wallet,
          )
          .filter(
            ({ readyState: nextReadyState }) => nextReadyState !== WalletReadyState.Unsupported,
          ),
      );
    }

    adapters.forEach((adapter) => adapter.on("readyStateChange", handleReadyStateChange, adapter));

    return () => {
      adapters.forEach((adapter) =>
        adapter.off("readyStateChange", handleReadyStateChange, adapter),
      );
    };
  }, [adapters]);

  const wallet = useMemo(
    () => wallets.find(({ adapter }) => adapter.name === activeWalletName) ?? null,
    [activeWalletName, wallets],
  );

  useEffect(() => {
    const adapter = wallet?.adapter;

    if (!adapter) {
      return;
    }

    const handleConnect = (nextPublicKey: PublicKey) => {
      connectedAdapterRef.current = adapter;
      setPublicKey(nextPublicKey);
      setConnected(true);
      setConnecting(false);
      setDisconnecting(false);
      setActiveWalletName(adapter.name);
    };

    const handleDisconnect = () => {
      if (connectedAdapterRef.current === adapter) {
        connectedAdapterRef.current = null;
      }

      setPublicKey(null);
      setConnected(false);
      setConnecting(false);
      setDisconnecting(false);
      setActiveWalletName((currentWalletName) =>
        currentWalletName === adapter.name ? null : currentWalletName,
      );
    };

    const handleAdapterError = (error: Error) => {
      setConnecting(false);
      setDisconnecting(false);
      reportError(error, adapter);
    };

    adapter.on("connect", handleConnect);
    adapter.on("disconnect", handleDisconnect);
    adapter.on("error", handleAdapterError);

    return () => {
      adapter.off("connect", handleConnect);
      adapter.off("disconnect", handleDisconnect);
      adapter.off("error", handleAdapterError);
    };
  }, [reportError, wallet]);

  const connectWallet = useCallback(
    async (walletName: WalletName) => {
      const nextWallet = wallets.find(({ adapter }) => adapter.name === walletName);

      if (!nextWallet) {
        const error = new Error("The selected Solana wallet is no longer available.");
        reportError(error);
        throw error;
      }

      const nextAdapter = nextWallet.adapter;

      if (!isSelectableWallet(nextWallet.readyState)) {
        if (typeof window !== "undefined") {
          window.open(nextAdapter.url, "_blank", "noopener,noreferrer");
        }

        const error = new WalletNotReadyError();
        reportError(error, nextAdapter);
        throw error;
      }

      if (nextAdapter.connected) {
        connectedAdapterRef.current = nextAdapter;
        setActiveWalletName(walletName);
        setPublicKey(nextAdapter.publicKey);
        setConnected(true);
        return;
      }

      setConnecting(true);

      try {
        const currentAdapter = connectedAdapterRef.current;

        if (currentAdapter && currentAdapter !== nextAdapter) {
          await currentAdapter.disconnect().catch((error) => {
            console.error("Failed to disconnect the previous wallet adapter", error);
          });
        }

        setActiveWalletName(walletName);
        await nextAdapter.connect();

        connectedAdapterRef.current = nextAdapter;
        setPublicKey(nextAdapter.publicKey);
        setConnected(nextAdapter.connected);
      } catch (error) {
        setActiveWalletName(null);
        setPublicKey(null);
        setConnected(false);

        const walletError =
          error instanceof Error ? error : new Error("Failed to connect the selected wallet.");
        reportError(walletError, nextAdapter);
        throw walletError;
      } finally {
        setConnecting(false);
      }
    },
    [reportError, wallets],
  );

  const disconnect = useCallback(async () => {
    const adapter = connectedAdapterRef.current ?? wallet?.adapter;

    if (!adapter) {
      setActiveWalletName(null);
      setPublicKey(null);
      setConnected(false);
      return;
    }

    setDisconnecting(true);

    try {
      await adapter.disconnect();
    } catch (error) {
      const walletError =
        error instanceof Error ? error : new Error("Failed to disconnect the active wallet.");
      reportError(walletError, adapter);
      throw walletError;
    } finally {
      connectedAdapterRef.current = null;
      setActiveWalletName(null);
      setPublicKey(null);
      setConnected(false);
      setDisconnecting(false);
    }
  }, [reportError, wallet]);

  const signIn = useMemo(() => {
    if (!wallet?.adapter || !("signIn" in wallet.adapter)) {
      return undefined;
    }

    const adapter = wallet.adapter as Adapter &
      Required<Pick<SignInMessageSignerWalletAdapterProps, "signIn">>;

    return async (input: Parameters<NonNullable<FortisWalletContextValue["signIn"]>>[0]) =>
      adapter.signIn(input);
  }, [wallet]);

  const signMessage = useMemo(() => {
    if (!wallet?.adapter || !("signMessage" in wallet.adapter)) {
      return undefined;
    }

    const adapter = wallet.adapter as Adapter &
      Required<Pick<MessageSignerWalletAdapterProps, "signMessage">>;

    return async (message: Uint8Array) => {
      if (!adapter.connected) {
        throw new WalletNotConnectedError();
      }

      return adapter.signMessage(message);
    };
  }, [wallet]);

  const value = useMemo<FortisWalletContextValue>(
    () => ({
      wallets,
      wallet,
      publicKey,
      connecting,
      connected,
      disconnecting,
      connectWallet,
      disconnect,
      signIn,
      signMessage,
    }),
    [
      connected,
      connectWallet,
      connecting,
      disconnect,
      disconnecting,
      publicKey,
      signIn,
      signMessage,
      wallet,
      wallets,
    ],
  );

  return <FortisWalletContext.Provider value={value}>{children}</FortisWalletContext.Provider>;
}

export function useWallet() {
  return useContext(FortisWalletContext);
}
