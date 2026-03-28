import { z } from "zod";

export const fortisSuccessWebhookSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  txHash: z.string().trim().min(1).nullable().optional(),
  status: z.string().trim().min(1).default("Completed"),
});

export type FortisSuccessWebhook = z.infer<typeof fortisSuccessWebhookSchema>;
