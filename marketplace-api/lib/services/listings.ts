import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { toListingDto, type ListingDto } from "@/lib/dto/listing";
import { ServiceError } from "@/lib/services/service-error";
import { createListingRequestSchema } from "@/lib/validators/listings";

export async function getListings(): Promise<ListingDto[]> {
  const listings = await prisma.listing.findMany({
    orderBy: {
      id: "desc",
    },
  });

  return listings.map(toListingDto);
}

export async function createListing(input: unknown): Promise<ListingDto> {
  const data = createListingRequestSchema.parse(input);

  const owner = await prisma.user.findUnique({
    where: {
      id: env.DEFAULT_LISTING_OWNER_ID,
    },
    select: {
      id: true,
    },
  });

  if (!owner) {
    throw new ServiceError(
      409,
      `Default owner ${env.DEFAULT_LISTING_OWNER_ID} does not exist in the users table.`,
    );
  }

  const listing = await prisma.listing.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      priceFiat: data.price,
      ownerId: owner.id,
      images: data.photo ? [data.photo] : [],
    },
  });

  return toListingDto(listing);
}
