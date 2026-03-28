import { prisma } from "@/lib/prisma";
import { toListingDto, type ListingDto } from "@/lib/dto/listing";
import { createListingRequestSchema } from "@/lib/validators/listings";

export async function getListings(): Promise<ListingDto[]> {
  const listings = await prisma.listing.findMany({
    orderBy: {
      id: "desc",
    },
  });

  return listings.map(toListingDto);
}

export async function createListing(input: unknown, ownerId: number): Promise<ListingDto> {
  const data = createListingRequestSchema.parse(input);

  const listing = await prisma.listing.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      priceFiat: data.price,
      ownerId,
      images: data.photo ? [data.photo] : [],
    },
  });

  return toListingDto(listing);
}
