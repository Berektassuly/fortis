import { z } from "zod";

import type { Database } from "../supabase/database.types.ts";

export const orderDtoSchema = z.object({
  id: z.number().int().positive(),
  listingId: z.number().int().positive().nullable(),
  userId: z.string().min(32).nullable(),
  status: z.string(),
  txHash: z.string().nullable(),
  fortisRequestId: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export const orderResultSchema = orderDtoSchema.extend({
  bridgeDispatched: z.boolean(),
  bridgeReference: z.string().nullable(),
});

export type OrderDto = z.infer<typeof orderDtoSchema>;
export type OrderResult = z.infer<typeof orderResultSchema>;

type OrderRecord = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "listing_id" | "user_id" | "status" | "tx_hash" | "fortis_request_id" | "error_message"
>;

export function toOrderDto(order: OrderRecord): OrderDto {
  return orderDtoSchema.parse({
    id: order.id,
    listingId: order.listing_id ?? null,
    userId: order.user_id ?? null,
    status: order.status ?? "Created",
    txHash: order.tx_hash ?? null,
    fortisRequestId: order.fortis_request_id ?? null,
    errorMessage: order.error_message ?? null,
  });
}

export function toOrderResult(
  order: OrderRecord,
  bridgeDispatched: boolean,
  bridgeReference: string | null,
): OrderResult {
  return orderResultSchema.parse({
    ...toOrderDto(order),
    bridgeDispatched,
    bridgeReference,
  });
}
