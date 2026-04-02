import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { toOrderDto, toOrderResult, type OrderDto, type OrderResult } from "@/lib/dto/order";
import { assertValidTransferIntentSignature } from "@/lib/solana/transfer-intent";
import {
  getFortisTransferRequest,
  submitTransferRequestToFortis,
} from "@/lib/services/fortis-client";
import {
  applyFortisWebhookUpdate,
  isTerminalOrderStatus,
  mapFortisTransferToOrderUpdate,
  persistOrderStatusUpdate,
} from "@/lib/services/order-updates";
import { ServiceError } from "@/lib/services/service-error";
import { requireMarketplaceUser } from "@/lib/services/users";
import type { Database } from "@/lib/supabase/database.types";
import { createOrderRequestSchema } from "@/lib/validators/orders";

const ORDER_SELECT =
  "id,listing_id,user_id,status,tx_hash,fortis_request_id,error_message";

function isUniqueViolation(error: PostgrestError | null, columnName?: string) {
  if (!error || error.code !== "23505") {
    return false;
  }

  if (!columnName) {
    return true;
  }

  const details = `${error.details ?? ""} ${error.message}`.toLowerCase();
  return details.includes(columnName.toLowerCase());
}

export async function createOrder(
  supabase: SupabaseClient<Database>,
  input: unknown,
  userWalletAddress: string,
): Promise<OrderResult> {
  const data = createOrderRequestSchema.parse(input);
  const user = await requireMarketplaceUser(supabase, userWalletAddress);

  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("id,owner_id,price_fiat,seller_wallet_address,token_mint_address,tokenization_status")
    .eq("id", data.listingId)
    .maybeSingle();

  if (listingError) {
    throw new ServiceError(500, listingError.message);
  }

  if (!listing) {
    throw new ServiceError(404, `Listing ${data.listingId} was not found.`);
  }

  if (!listing.owner_id || !listing.seller_wallet_address || !listing.token_mint_address) {
    throw new ServiceError(409, "This listing is not fully tokenized yet.");
  }

  if (listing.tokenization_status !== "active") {
    throw new ServiceError(409, "This listing is still being prepared for trading.");
  }

  if (listing.owner_id === user.id) {
    throw new ServiceError(409, "You cannot buy your own listing in the demo flow.");
  }

  const buyerWalletAddress = user.id;
  const verifiedTransferIntent = await assertValidTransferIntentSignature(
    data.transferIntent,
  );
  const intentFromAddress = verifiedTransferIntent.fromAddress;
  const intentToAddress = verifiedTransferIntent.toAddress;
  const intentMint = verifiedTransferIntent.mint;

  if (intentFromAddress !== buyerWalletAddress || intentToAddress !== buyerWalletAddress) {
    throw new ServiceError(
      409,
      "The signed wallet intent must come from the wallet used for your Fortis SIWS session.",
    );
  }

  if (intentMint !== listing.token_mint_address) {
    throw new ServiceError(400, "The signed mint does not match this listing.");
  }

  if (data.transferIntent.amount !== 1) {
    throw new ServiceError(400, "This demo purchase flow currently transfers exactly 1 asset token.");
  }

  const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert({
      listing_id: listing.id,
      user_id: user.id,
      buyer_wallet_address: buyerWalletAddress,
      nonce: verifiedTransferIntent.nonce,
      seller_wallet_address: listing.seller_wallet_address,
      status: "Pending",
      token_mint_address: listing.token_mint_address,
    })
    .select(ORDER_SELECT)
    .single();

  if (isUniqueViolation(insertError, "nonce")) {
    throw new ServiceError(409, "This signed purchase intent was already submitted.");
  }

  if (insertError) {
    throw new ServiceError(500, insertError.message);
  }

  if (!order) {
    throw new ServiceError(500, "Failed to create the Fortis order.");
  }

  try {
    const fortisTransfer = await submitTransferRequestToFortis({
      amount: verifiedTransferIntent.amount,
      from_address: buyerWalletAddress,
      mint: listing.token_mint_address,
      nonce: verifiedTransferIntent.nonce,
      signature: verifiedTransferIntent.signature,
      source_owner_address: listing.seller_wallet_address,
      to_address: buyerWalletAddress,
    });

    const mappedStatus = mapFortisTransferToOrderUpdate(fortisTransfer);
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({
        error_message: mappedStatus.errorMessage,
        fortis_request_id: fortisTransfer.id,
        status: mappedStatus.status,
        tx_hash: mappedStatus.txHash,
      })
      .eq("id", order.id)
      .select(ORDER_SELECT)
      .single();

    if (updateError) {
      throw new ServiceError(500, updateError.message);
    }

    if (!updatedOrder) {
      throw new ServiceError(500, "Failed to persist the Fortis transfer request.");
    }

    return toOrderResult(updatedOrder, true, fortisTransfer.id);
  } catch (error) {
    console.error("Failed to dispatch Fortis order intent", error);

    const { data: failedOrder, error: failedOrderError } = await supabase
      .from("orders")
      .update({
        error_message:
          error instanceof Error ? error.message : "Failed to submit the purchase intent.",
        status: "Failed",
      })
      .eq("id", order.id)
      .select(ORDER_SELECT)
      .single();

    if (failedOrderError) {
      throw new ServiceError(500, failedOrderError.message);
    }

    if (!failedOrder) {
      throw new ServiceError(500, "Failed to persist the failed Fortis order.");
    }

    return toOrderResult(failedOrder, false, null);
  }
}

export async function getOrderForUser(
  supabase: SupabaseClient<Database>,
  orderId: number,
  userWalletAddress: string,
): Promise<OrderDto> {
  const user = await requireMarketplaceUser(supabase, userWalletAddress);
  const { data: existingOrder, error: orderError } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (orderError) {
    throw new ServiceError(500, orderError.message);
  }

  if (!existingOrder) {
    throw new ServiceError(404, `Order ${orderId} was not found.`);
  }

  let order = existingOrder;

  if (
    order.fortis_request_id &&
    !isTerminalOrderStatus(order.status)
  ) {
    try {
      const fortisTransfer = await getFortisTransferRequest(order.fortis_request_id);
      order = await persistOrderStatusUpdate(
        supabase,
        order,
        mapFortisTransferToOrderUpdate(fortisTransfer),
        ORDER_SELECT,
      );
    } catch (error) {
      console.error("Failed to refresh Fortis transfer request", error);
    }
  }

  return toOrderDto(order);
}

export async function applyFortisSuccessWebhook(
  supabase: SupabaseClient<Database>,
  input: unknown,
): Promise<OrderDto> {
  return applyFortisWebhookUpdate(supabase, input, ORDER_SELECT);
}
