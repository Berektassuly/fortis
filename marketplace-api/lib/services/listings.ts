import { Prisma } from "@prisma/client";
import { PublicKey } from "@solana/web3.js";

import { prisma } from "@/lib/prisma";
import { toListingDto, type ListingDto } from "@/lib/dto/listing";
import { tokenizeListingWithFortis } from "@/lib/services/fortis-client";
import { ServiceError } from "@/lib/services/service-error";
import { createListingRequestSchema } from "@/lib/validators/listings";

export async function getListings(): Promise<ListingDto[]> {
  const listings = await prisma.listing.findMany({
    where: {
      tokenizationStatus: "active",
    },
    orderBy: {
      id: "desc",
    },
  });

  return listings.map(toListingDto);
}

function normalizeWalletAddress(walletAddress: string) {
  try {
    return new PublicKey(walletAddress).toBase58();
  } catch (error) {
    throw new ServiceError(
      400,
      error instanceof Error ? error.message : "Invalid Solana wallet address.",
    );
  }
}

export async function createListing(input: unknown, ownerId: number): Promise<ListingDto> {
  const data = createListingRequestSchema.parse(input);
  const owner = await prisma.user.findUnique({
    where: {
      id: ownerId,
    },
    select: {
      id: true,
      solanaWalletAddress: true,
    },
  });

  if (!owner) {
    throw new ServiceError(404, `User ${ownerId} was not found.`);
  }

  if (!owner.solanaWalletAddress) {
    throw new ServiceError(409, "Connect and link your Solana wallet before publishing a listing.");
  }

  const requestWalletAddress = normalizeWalletAddress(data.walletAddress);

  if (requestWalletAddress !== owner.solanaWalletAddress) {
    throw new ServiceError(
      409,
      "The connected wallet does not match the wallet linked to your Fortis account.",
    );
  }

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
          city: data.city ?? null,
          rooms: data.rooms ?? null,
          ownerId,
          sellerWalletAddress: owner.solanaWalletAddress,
          tokenizationStatus: "tokenizing",
          images: data.photo ? [data.photo] : [],
        },
      });

      try {
        const tokenization = await tokenizeListingWithFortis({
          city: listing.city,
          description: listing.description,
          imageUrl: listing.images[0] ?? null,
          listingId: listing.id,
          priceFiat: listing.priceFiat ?? 0,
          sellerWalletAddress: owner.solanaWalletAddress,
          title: listing.title ?? `Listing #${listing.id}`,
        });

        const activatedListing = await prisma.listing.update({
          where: {
            id: listing.id,
          },
          data: {
            sellerWalletAddress: owner.solanaWalletAddress,
            tokenMintAddress: tokenization.tokenMintAddress,
            tokenizationError: null,
            tokenizationStatus: "active",
          },
        });

        return toListingDto(activatedListing);
      } catch (error) {
        await prisma.listing.update({
          where: {
            id: listing.id,
          },
          data: {
            tokenizationError:
              error instanceof Error ? error.message : "Listing tokenization failed.",
            tokenizationStatus: "failed",
          },
        });

        throw new ServiceError(
          502,
          error instanceof Error
            ? error.message
            : "Listing tokenization failed before publish could complete.",
        );
      }
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
