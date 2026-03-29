import type { ListingDto } from "@/lib/dto/listing";

export const DEFAULT_LISTING_CITY = "Алматы";
export const DEFAULT_LISTING_ROOMS = 2;

export interface MarketplaceListing extends ListingDto {
  city: string;
  rooms: number;
}

export function toMarketplaceListing(listing: ListingDto): MarketplaceListing {
  return {
    ...listing,
    city: listing.city ?? DEFAULT_LISTING_CITY,
    rooms: listing.rooms ?? DEFAULT_LISTING_ROOMS,
  };
}
