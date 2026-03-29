import type { Listing } from "@prisma/client";
import { z } from "zod";

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
  Listing,
  | "id"
  | "title"
  | "priceFiat"
  | "description"
  | "images"
  | "city"
  | "rooms"
  | "tokenMintAddress"
  | "tokenizationStatus"
>;

export function toListingDto(listing: ListingRecord): ListingDto {
  return listingDtoSchema.parse({
    id: listing.id,
    title: listing.title ?? "",
    price: listing.priceFiat ?? 0,
    description: listing.description ?? null,
    photo: listing.images[0] ?? null,
    city: listing.city ?? null,
    rooms: listing.rooms ?? null,
    tokenMintAddress: listing.tokenMintAddress ?? null,
    tokenizationStatus: listing.tokenizationStatus,
  });
}
