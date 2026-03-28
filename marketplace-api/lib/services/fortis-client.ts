import crypto from "node:crypto";

import { env } from "@/lib/env";

export interface FortisOrderIntent {
  orderId: number;
  listingId: number;
  userId: number;
}

export interface FortisDispatchResult {
  dispatched: boolean;
  reference: string | null;
}

function getFortisOrderUrl() {
  if (!env.FORTIS_ENGINE_URL) {
    return null;
  }

  return new URL(env.FORTIS_ENGINE_ORDER_PATH, `${env.FORTIS_ENGINE_URL.replace(/\/$/, "")}/`);
}

export async function dispatchOrderIntentToFortis(
  payload: FortisOrderIntent,
): Promise<FortisDispatchResult> {
  const targetUrl = getFortisOrderUrl();

  if (!targetUrl) {
    return {
      dispatched: false,
      reference: null,
    };
  }

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.FORTIS_ENGINE_TOKEN ? { Authorization: `Bearer ${env.FORTIS_ENGINE_TOKEN}` } : {}),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Fortis engine request failed with ${response.status}${details ? `: ${details}` : ""}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      dispatched: true,
      reference: null,
    };
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const reference = body?.reference ?? body?.id ?? body?.orderId;

  return {
    dispatched: true,
    reference:
      typeof reference === "string" || typeof reference === "number" ? String(reference) : null,
  };
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
