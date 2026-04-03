import type { SupabaseClient } from "@supabase/supabase-js";

import { toListingDto, type ListingDto } from "@/lib/dto/listing";
import { tokenizeListingWithFortis } from "@/lib/services/fortis-client";
import { ServiceError } from "@/lib/services/service-error";
import { requireMarketplaceUser } from "@/lib/services/users";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeWalletAddress } from "@/lib/supabase/wallet-auth";
import { createListingRequestSchema } from "@/lib/validators/listings";

const LISTING_SELECT =
  "id,title,price_fiat,description,images,city,rooms,token_mint_address,tokenization_status";

async function getSoldListingIds(
  supabase: SupabaseClient<Database>,
  listingIds: number[],
) {
  if (listingIds.length === 0) {
    return new Set<number>();
  }

  const { data, error } = await supabase
    .from("orders")
    .select("listing_id")
    .eq("status", "Success")
    .in("listing_id", listingIds);

  if (error) {
    throw new ServiceError(500, error.message);
  }

  return new Set(
    (data ?? [])
      .map((order) => order.listing_id)
      .filter((listingId): listingId is number => typeof listingId === "number"),
  );
}

export async function getListings(supabase: SupabaseClient<Database>): Promise<ListingDto[]> {
  const { data, error } = await supabase
    .from("listings")
    .select(LISTING_SELECT)
    .eq("tokenization_status", "active")
    .order("id", { ascending: false });

  if (error) {
    throw new ServiceError(500, error.message);
  }

  const listings = data ?? [];
  const soldListingIds = await getSoldListingIds(
    supabase,
    listings.map((listing) => listing.id),
  );

  return listings
    .filter((listing) => !soldListingIds.has(listing.id))
    .map(toListingDto);
}

function requireWalletAddress(walletAddress: string) {
  const normalizedWalletAddress = normalizeWalletAddress(walletAddress);

  if (!normalizedWalletAddress) {
    throw new ServiceError(400, "Invalid Solana wallet address.");
  }

  return normalizedWalletAddress;
}

export async function createListing(
  supabase: SupabaseClient<Database>,
  input: unknown,
  ownerWalletAddress: string,
): Promise<ListingDto> {
  const data = createListingRequestSchema.parse(input);
  const owner = await requireMarketplaceUser(supabase, ownerWalletAddress);

  const requestWalletAddress = requireWalletAddress(data.walletAddress);

  if (requestWalletAddress !== owner.id) {
    throw new ServiceError(
      409,
      "The connected wallet does not match the wallet used for your Fortis SIWS session.",
    );
  }

  const { data: listing, error: insertError } = await supabase
    .from("listings")
    .insert({
      title: data.title,
      description: data.description ?? null,
      price_fiat: data.price,
      city: data.city ?? null,
      rooms: data.rooms ?? null,
      owner_id: owner.id,
      seller_wallet_address: owner.id,
      tokenization_status: "tokenizing",
      images: data.photo ? [data.photo] : [],
    })
    .select("id,title,description,price_fiat,city,images")
    .single();

  if (insertError) {
    throw new ServiceError(500, insertError.message);
  }

  if (!listing) {
    throw new ServiceError(500, "Failed to create the Fortis listing.");
  }

  try {
    const tokenization = await tokenizeListingWithFortis({
      city: listing.city,
      description: listing.description,
      imageUrl: Array.isArray(listing.images) ? listing.images[0] ?? null : null,
      listingId: listing.id,
      priceFiat: Number(listing.price_fiat ?? 0),
      sellerWalletAddress: owner.id,
      title: listing.title ?? `Listing #${listing.id}`,
    });

    const { data: activatedListing, error: updateError } = await supabase
      .from("listings")
      .update({
        seller_wallet_address: owner.id,
        token_mint_address: tokenization.tokenMintAddress,
        tokenization_error: null,
        tokenization_status: "active",
      })
      .eq("id", listing.id)
      .select(LISTING_SELECT)
      .single();

    if (updateError) {
      throw new ServiceError(500, updateError.message);
    }

    if (!activatedListing) {
      throw new ServiceError(500, "Failed to finalize the tokenized listing.");
    }

    return toListingDto(activatedListing);
  } catch (error) {
    const failureMessage =
      error instanceof Error ? error.message : "Listing tokenization failed.";

    console.error("Listing tokenization failed", {
      error: failureMessage,
      listingId: listing.id,
      ownerId: owner.id,
    });

    const { error: markFailedError } = await supabase
      .from("listings")
      .update({
        tokenization_error: failureMessage,
        tokenization_status: "failed",
      })
      .eq("id", listing.id);

    if (markFailedError) {
      console.error("Failed to mark listing tokenization failure", markFailedError);
    }

    throw new ServiceError(502, failureMessage);
  }
}

export async function getPurchasedListingsForUser(
  supabase: SupabaseClient<Database>,
  walletAddress: string,
): Promise<ListingDto[]> {
  const user = await requireMarketplaceUser(supabase, walletAddress);
  const { data: successfulOrders, error: ordersError } = await supabase
    .from("orders")
    .select("listing_id,created_at")
    .eq("status", "Success")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (ordersError) {
    throw new ServiceError(500, ordersError.message);
  }

  const purchasedListingIds = Array.from(
    new Set(
      (successfulOrders ?? [])
        .map((order) => order.listing_id)
        .filter((listingId): listingId is number => typeof listingId === "number"),
    ),
  );

  if (purchasedListingIds.length === 0) {
    return [];
  }

  const { data: purchasedListings, error: listingsError } = await supabase
    .from("listings")
    .select(LISTING_SELECT)
    .in("id", purchasedListingIds);

  if (listingsError) {
    throw new ServiceError(500, listingsError.message);
  }

  const listingsById = new Map(
    (purchasedListings ?? []).map((listing) => [listing.id, toListingDto(listing)]),
  );

  return purchasedListingIds
    .map((listingId) => listingsById.get(listingId))
    .filter((listing): listing is ListingDto => Boolean(listing));
}
