import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";

export const listingDtoSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  price: z.number(),
  description: z.string().nullable(),
  photo: z.string().nullable(),
  city: z.string().nullable(),
  rooms: z.number().int().positive().nullable(),
  tokenMintAddress: z.string().nullable(),
  tokenizationStatus: z.string(),
});

export type ListingDto = z.infer<typeof listingDtoSchema>;

type ListingRecord = Pick<
  Database["public"]["Tables"]["listings"]["Row"],
  | "id"
  | "title"
  | "price_fiat"
  | "description"
  | "images"
  | "city"
  | "rooms"
  | "token_mint_address"
  | "tokenization_status"
>;

function toNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
}

export function toListingDto(listing: ListingRecord): ListingDto {
  return listingDtoSchema.parse({
    id: listing.id,
    title: listing.title ?? "",
    price: toNumericValue(listing.price_fiat),
    description: listing.description ?? null,
    photo: Array.isArray(listing.images) ? listing.images[0] ?? null : null,
    city: listing.city ?? null,
    rooms: listing.rooms ?? null,
    tokenMintAddress: listing.token_mint_address ?? null,
    tokenizationStatus: listing.tokenization_status ?? "draft",
  });
}
