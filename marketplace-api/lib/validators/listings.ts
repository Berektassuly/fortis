import { z } from "zod";

export const createListingRequestSchema = z.object({
  title: z.string().trim().min(1).max(100),
  price: z.coerce.number().finite().nonnegative(),
  description: z.string().trim().max(1000).nullable().optional(),
  photo: z.string().trim().url().nullable().optional(),
  city: z.string().trim().min(1).max(80).optional(),
  rooms: z.coerce.number().int().positive().max(20).optional(),
  walletAddress: z.string().trim().min(1),
});

export type CreateListingRequest = z.infer<typeof createListingRequestSchema>;
