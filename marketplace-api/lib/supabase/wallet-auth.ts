import type { User, UserIdentity } from "@supabase/supabase-js";
import bs58 from "bs58";

const SOLANA_IDENTITY_PROVIDERS = new Set(["solana", "eip4361"]);
const SOLANA_PUBLIC_KEY_LENGTH = 32;

export const FORTIS_SIWS_STATEMENT =
  "I confirm this wallet as my sole identity for Fortis Marketplace.";

function normalizeSolanaSubject(value: string) {
  if (!value.startsWith("solana:")) {
    return value;
  }

  const parts = value.split(":");
  return parts[parts.length - 1] ?? value;
}

export function normalizeWalletAddress(walletAddress: string) {
  const value = normalizeSolanaSubject(walletAddress.trim());

  if (!value) {
    return null;
  }

  try {
    const decodedWalletAddress = bs58.decode(value);

    if (decodedWalletAddress.length !== SOLANA_PUBLIC_KEY_LENGTH) {
      return null;
    }

    return bs58.encode(decodedWalletAddress);
  } catch {
    return null;
  }
}

function getWalletAddressFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) {
    return null;
  }

  const customClaims =
    typeof metadata.custom_claims === "object" && metadata.custom_claims !== null
      ? (metadata.custom_claims as Record<string, unknown>)
      : null;

  return (
    normalizeWalletAddress(String(customClaims?.address ?? "")) ??
    normalizeWalletAddress(String(metadata.address ?? "")) ??
    normalizeWalletAddress(String(metadata.sub ?? ""))
  );
}

function getWalletAddressFromIdentity(identity: UserIdentity) {
  if (!SOLANA_IDENTITY_PROVIDERS.has(identity.provider)) {
    return null;
  }

  const identityData =
    typeof identity.identity_data === "object" && identity.identity_data !== null
      ? (identity.identity_data as Record<string, unknown>)
      : null;

  return getWalletAddressFromMetadata(identityData);
}

export function extractWalletAddressFromSupabaseUser(
  user: Pick<User, "identities" | "user_metadata"> | null | undefined,
): string | null {
  const fromMetadata = getWalletAddressFromMetadata(
    user?.user_metadata as Record<string, unknown> | null | undefined,
  );

  if (fromMetadata) {
    return fromMetadata;
  }

  for (const identity of user?.identities ?? []) {
    const walletAddress = getWalletAddressFromIdentity(identity);

    if (walletAddress) {
      return walletAddress;
    }
  }

  return null;
}

export function shortenWalletAddress(walletAddress: string | null | undefined) {
  if (!walletAddress) {
    return "Wallet unavailable";
  }

  return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
}
