import type { Listing } from "@prisma/client";
import { z } from "zod";

export const listingDtoSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  price: z.number(),
  description: z.string().nullable(),
  photo: z.string().nullable(),
});

export type ListingDto = z.infer<typeof listingDtoSchema>;

type ListingRecord = Pick<Listing, "id" | "title" | "priceFiat" | "description" | "images">;

export function toListingDto(listing: ListingRecord): ListingDto {
  return listingDtoSchema.parse({
    id: listing.id,
    title: listing.title ?? "",
    price: listing.priceFiat ?? 0,
    description: listing.description ?? null,
    photo: listing.images[0] ?? null,
  });
}
