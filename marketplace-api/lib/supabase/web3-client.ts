import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { SolanaWallet } from "@supabase/auth-js";

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

  if (existingUserError) {
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
