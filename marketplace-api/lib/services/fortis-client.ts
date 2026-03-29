import crypto from "node:crypto";

import { env } from "@/lib/env";

export interface FortisTokenizeListingPayload {
  city?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  listingId: number;
  priceFiat: number;
  sellerWalletAddress: string;
  title: string;
}

export interface FortisTokenizeListingResult {
  assetRecordPda: string;
  delegateWalletAddress: string;
  plannedSupply: number;
  sellerComplianceRecordPda: string;
  tokenMintAddress: string;
}

export interface FortisSubmitTransferRequestPayload {
  amount: number;
  from_address: string;
  mint: string;
  nonce: string;
  signature: string;
  source_owner_address?: string | null;
  to_address: string;
}

export interface FortisTransferRequestResult {
  blockchain_signature: string | null;
  blockchain_last_error?: string | null;
  blockchain_status: string;
  compliance_status: string;
  id: string;
}

function getFortisUrl(path: string) {
  if (!env.FORTIS_ENGINE_URL) {
    return null;
  }

  return new URL(path, `${env.FORTIS_ENGINE_URL.replace(/\/$/, "")}/`);
}

async function requestFortis<T>(path: string, init: RequestInit): Promise<T> {
  const targetUrl = getFortisUrl(path);

  if (!targetUrl) {
    throw new Error("FORTIS_ENGINE_URL is not configured.");
  }

  const response = await fetch(targetUrl, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(env.FORTIS_ENGINE_TOKEN ? { Authorization: `Bearer ${env.FORTIS_ENGINE_TOKEN}` } : {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Fortis engine request failed with ${response.status}${details ? `: ${details}` : ""}`);
  }

  return (await response.json()) as T;
}

export async function tokenizeListingWithFortis(
  payload: FortisTokenizeListingPayload,
): Promise<FortisTokenizeListingResult> {
  return requestFortis<FortisTokenizeListingResult>(env.FORTIS_ENGINE_TOKENIZE_PATH, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

export async function submitTransferRequestToFortis(
  payload: FortisSubmitTransferRequestPayload,
): Promise<FortisTransferRequestResult> {
  return requestFortis<FortisTransferRequestResult>(env.FORTIS_ENGINE_TRANSFER_REQUEST_PATH, {
    body: JSON.stringify({
      from_address: payload.from_address,
      nonce: payload.nonce,
      signature: payload.signature,
      source_owner_address: payload.source_owner_address ?? null,
      to_address: payload.to_address,
      token_mint: payload.mint,
      transfer_details: {
        amount: payload.amount,
        type: "public",
      },
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": payload.nonce,
    },
    method: "POST",
  });
}

export async function getFortisTransferRequest(
  requestId: string,
): Promise<FortisTransferRequestResult> {
  return requestFortis<FortisTransferRequestResult>(
    `${env.FORTIS_ENGINE_TRANSFER_REQUEST_PATH.replace(/\/$/, "")}/${requestId}`,
    {
      method: "GET",
    },
  );
}

export function verifyFortisWebhookSignature(rawBody: string, signatureHeader: string | null) {
  if (!env.FORTIS_WEBHOOK_SECRET || !signatureHeader) {
    return false;
  }

  const providedSignature = signatureHeader.replace(/^sha256=/i, "").trim();
  if (!providedSignature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.FORTIS_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const providedBuffer = Buffer.from(providedSignature, "hex");

  if (expectedBuffer.length === 0 || expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
