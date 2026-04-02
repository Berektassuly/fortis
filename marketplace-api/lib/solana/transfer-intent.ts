import { webcrypto } from "node:crypto";

import bs58 from "bs58";

import { ServiceError } from "@/lib/services/service-error";
import { normalizeWalletAddress } from "@/lib/supabase/wallet-auth";

const SOLANA_PUBLIC_KEY_LENGTH = 32;
const ED25519_SIGNATURE_LENGTH = 64;

export interface SignedTransferIntentPayload {
  amount: number;
  fromAddress: string;
  mint: string;
  nonce: string;
  signature: string;
  toAddress: string;
}

export interface VerifiedTransferIntent {
  amount: number;
  fromAddress: string;
  mint: string;
  nonce: string;
  signature: string;
  toAddress: string;
}

function requireNormalizedWalletAddress(walletAddress: string, fieldName: string) {
  const normalizedWalletAddress = normalizeWalletAddress(walletAddress);

  if (!normalizedWalletAddress) {
    throw new ServiceError(400, `Invalid Solana wallet address in ${fieldName}.`);
  }

  return normalizedWalletAddress;
}

function decodeBase58(input: string, fieldName: string) {
  try {
    return bs58.decode(input);
  } catch {
    throw new ServiceError(400, `Invalid base58 value in ${fieldName}.`);
  }
}

export function createTransferIntentMessage({
  amount,
  fromAddress,
  mint,
  nonce,
  toAddress,
}: Omit<VerifiedTransferIntent, "signature">) {
  return `${fromAddress}:${toAddress}:${amount}:${mint}:${nonce}`;
}

export async function assertValidTransferIntentSignature(
  transferIntent: SignedTransferIntentPayload,
): Promise<VerifiedTransferIntent> {
  const normalizedFromAddress = requireNormalizedWalletAddress(
    transferIntent.fromAddress,
    "transferIntent.fromAddress",
  );
  const normalizedToAddress = requireNormalizedWalletAddress(
    transferIntent.toAddress,
    "transferIntent.toAddress",
  );
  const normalizedMint = requireNormalizedWalletAddress(
    transferIntent.mint,
    "transferIntent.mint",
  );
  const publicKeyBytes = decodeBase58(
    normalizedFromAddress,
    "transferIntent.fromAddress",
  );
  const signatureBytes = decodeBase58(
    transferIntent.signature,
    "transferIntent.signature",
  );

  if (publicKeyBytes.length !== SOLANA_PUBLIC_KEY_LENGTH) {
    throw new ServiceError(400, "Invalid Solana public key length in transferIntent.fromAddress.");
  }

  if (signatureBytes.length !== ED25519_SIGNATURE_LENGTH) {
    throw new ServiceError(400, "Invalid Ed25519 signature length in transferIntent.signature.");
  }

  const cryptoKey = await webcrypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const message = createTransferIntentMessage({
    amount: transferIntent.amount,
    fromAddress: normalizedFromAddress,
    mint: normalizedMint,
    nonce: transferIntent.nonce,
    toAddress: normalizedToAddress,
  });
  const verified = await webcrypto.subtle.verify(
    "Ed25519",
    cryptoKey,
    signatureBytes,
    new TextEncoder().encode(message),
  );

  if (!verified) {
    throw new ServiceError(
      403,
      "The signed transfer intent could not be verified for this wallet session.",
    );
  }

  return {
    amount: transferIntent.amount,
    fromAddress: normalizedFromAddress,
    mint: normalizedMint,
    nonce: transferIntent.nonce,
    signature: transferIntent.signature,
    toAddress: normalizedToAddress,
  };
}
