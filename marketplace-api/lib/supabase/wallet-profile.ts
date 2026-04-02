export interface WalletProfile {
  authUserId: string | null;
  id: string;
  solanaWalletAddress: string;
}

export async function fetchCurrentWalletProfile() {
  const response = await fetch("/api/me/wallet", {
    cache: "no-store",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to resolve the current Fortis wallet session.");
  }

  return (await response.json()) as WalletProfile;
}
