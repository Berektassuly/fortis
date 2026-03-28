import { z } from "zod";

export const createOrderRequestSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
