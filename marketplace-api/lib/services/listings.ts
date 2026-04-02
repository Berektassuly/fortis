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

export async function getListings(supabase: SupabaseClient<Database>): Promise<ListingDto[]> {
  const { data, error } = await supabase
    .from("listings")
    .select(LISTING_SELECT)
    .eq("tokenization_status", "active")
    .order("id", { ascending: false });

  if (error) {
    throw new ServiceError(500, error.message);
  }

  return (data ?? []).map(toListingDto);
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
