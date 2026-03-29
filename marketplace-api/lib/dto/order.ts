import type { Order } from "@prisma/client";
import { z } from "zod";

export const orderDtoSchema = z.object({
  id: z.number().int().positive(),
  listingId: z.number().int().positive().nullable(),
  userId: z.number().int().positive().nullable(),
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
  Order,
  "id" | "listingId" | "userId" | "status" | "txHash" | "fortisRequestId" | "errorMessage"
>;

export function toOrderDto(order: OrderRecord): OrderDto {
  return orderDtoSchema.parse({
    id: order.id,
    listingId: order.listingId ?? null,
    userId: order.userId ?? null,
    status: order.status ?? "Created",
    txHash: order.txHash ?? null,
    fortisRequestId: order.fortisRequestId ?? null,
    errorMessage: order.errorMessage ?? null,
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
