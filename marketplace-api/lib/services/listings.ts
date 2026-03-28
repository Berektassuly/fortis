import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
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

export async function createListing(input: unknown, ownerId: number): Promise<ListingDto> {
  const data = createListingRequestSchema.parse(input);

  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const highestListing = await prisma.listing.findFirst({
      select: {
        id: true,
      },
      orderBy: {
        id: "desc",
      },
    });

    try {
      const listing = await prisma.listing.create({
        data: {
          id: (highestListing?.id ?? 0) + 1,
          title: data.title,
          description: data.description ?? null,
          priceFiat: data.price,
          ownerId,
          images: data.photo ? [data.photo] : [],
        },
      });

      return toListingDto(listing);
    } catch (error) {
      lastError = error;

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes("id")
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new ServiceError(
    500,
    lastError instanceof Error ? lastError.message : "Failed to create listing after multiple retries.",
  );
}
