import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAuthSessionMissingError, type SolanaWallet } from "@supabase/auth-js";

import {
  extractWalletAddressFromSupabaseUser,
  FORTIS_SIWS_STATEMENT,
  normalizeWalletAddress,
} from "@/lib/supabase/wallet-auth";

type BrowserSupabaseClient = Pick<SupabaseClient, "auth">;

export interface WalletSignInResult {
  kind: "already-signed-in" | "signed-in" | "switched-wallet";
  user: User;
  walletAddress: string;
}

function isAuthApiErrorWithCode(
  error: unknown,
  code: string,
): error is { code: string; message?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code === code
  );
}

export async function signInWithConnectedWallet({
  connectedWalletAddress,
  supabase,
  wallet,
}: {
  connectedWalletAddress: string;
  supabase: BrowserSupabaseClient;
  wallet: SolanaWallet;
}): Promise<WalletSignInResult> {
  const normalizedConnectedWalletAddress = normalizeWalletAddress(connectedWalletAddress);

  if (!normalizedConnectedWalletAddress) {
    throw new Error("Connect a valid Solana wallet before continuing.");
  }

  const {
    data: { user: existingUser },
    error: existingUserError,
  } = await supabase.auth.getUser();

  if (existingUserError && !isAuthSessionMissingError(existingUserError)) {
    throw existingUserError;
  }

  const existingWalletAddress = extractWalletAddressFromSupabaseUser(existingUser);

  if (existingUser && existingWalletAddress === normalizedConnectedWalletAddress) {
    return {
      kind: "already-signed-in",
      user: existingUser,
      walletAddress: normalizedConnectedWalletAddress,
    };
  }

  if (existingUser) {
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      throw signOutError;
    }
  }

  const { data, error } = await supabase.auth.signInWithWeb3({
    chain: "solana",
    statement: FORTIS_SIWS_STATEMENT,
    wallet,
  });

  if (error) {
    if (isAuthApiErrorWithCode(error, "web3_provider_disabled")) {
      throw new Error(
        "Supabase Web3 auth is disabled for this project. Enable Authentication > Providers > Web3 Wallet > Solana before trying SIWS again.",
      );
    }

    throw error;
  }

  if (!data.user) {
    throw new Error("Supabase did not return a user for the signed wallet session.");
  }

  return {
    kind:
      existingWalletAddress && existingWalletAddress !== normalizedConnectedWalletAddress
        ? "switched-wallet"
        : "signed-in",
    user: data.user,
    walletAddress:
      extractWalletAddressFromSupabaseUser(data.user) ?? normalizedConnectedWalletAddress,
  };
}
