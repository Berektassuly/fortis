import { z } from "zod";

const signedTransferIntentSchema = z.object({
  amount: z.coerce.number().int().positive(),
  fromAddress: z.string().trim().min(1),
  mint: z.string().trim().min(1),
  nonce: z.string().trim().min(32).max(64),
  signature: z.string().trim().min(1),
  toAddress: z.string().trim().min(1),
});

export const createOrderRequestSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  transferIntent: signedTransferIntentSchema,
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type SignedTransferIntent = z.infer<typeof signedTransferIntentSchema>;
