import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { PublicKey } from "@solana/web3.js";

import { toOrderDto, toOrderResult, type OrderDto, type OrderResult } from "@/lib/dto/order";
import {
  getFortisTransferRequest,
  submitTransferRequestToFortis,
  type FortisTransferRequestResult,
} from "@/lib/services/fortis-client";
import { ServiceError } from "@/lib/services/service-error";
import { requireMarketplaceUser } from "@/lib/services/users";
import type { Database, OrderStatus } from "@/lib/supabase/database.types";
import { createOrderRequestSchema } from "@/lib/validators/orders";
import { fortisSuccessWebhookSchema } from "@/lib/validators/webhooks";

const ORDER_SELECT =
  "id,listing_id,user_id,status,tx_hash,fortis_request_id,error_message";

interface OrderStatusUpdate {
  errorMessage: string | null;
  status: OrderStatus;
  txHash: string | null;
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

function normalizeOrderStatus(status: string | null | undefined): OrderStatus {
  switch (status?.trim().toLowerCase()) {
    case "created":
      return "Created";
    case "pending":
      return "Pending";
    case "processing":
      return "Processing";
    case "completed":
    case "success":
      return "Success";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}

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

function mapFortisTransferToOrderUpdate(
  transferRequest: FortisTransferRequestResult,
): OrderStatusUpdate {
  const blockchainStatus = transferRequest.blockchain_status.toLowerCase();
  const complianceStatus = transferRequest.compliance_status.toLowerCase();

  if (blockchainStatus === "confirmed") {
    return {
      errorMessage: null,
      status: "Success",
      txHash: transferRequest.blockchain_signature ?? null,
    };
  }

  if (
    complianceStatus === "rejected" ||
    blockchainStatus === "failed" ||
    blockchainStatus === "expired"
  ) {
    return {
      errorMessage:
        transferRequest.blockchain_last_error ??
        (complianceStatus === "rejected"
          ? "Buyer compliance screening was rejected."
          : "The blockchain transfer failed."),
      status: "Failed",
      txHash: transferRequest.blockchain_signature ?? null,
    };
  }

  if (
    blockchainStatus === "submitted" ||
    blockchainStatus === "processing" ||
    blockchainStatus === "pending_submission"
  ) {
    return {
      errorMessage: null,
      status: "Processing",
      txHash: transferRequest.blockchain_signature ?? null,
    };
  }

  return {
    errorMessage: null,
    status: "Pending" as OrderStatus,
    txHash: transferRequest.blockchain_signature ?? null,
  };
}

export async function createOrder(
  supabase: SupabaseClient<Database>,
  input: unknown,
  userAuthUserId: string,
): Promise<OrderResult> {
  const data = createOrderRequestSchema.parse(input);
  const user = await requireMarketplaceUser(supabase, userAuthUserId);

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

  if (!user.solanaWalletAddress) {
    throw new ServiceError(409, "Connect and link your Solana wallet before placing an order.");
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

  const buyerWalletAddress = user.solanaWalletAddress;
  const intentFromAddress = normalizeWalletAddress(data.transferIntent.fromAddress);
  const intentToAddress = normalizeWalletAddress(data.transferIntent.toAddress);
  const intentMint = normalizeWalletAddress(data.transferIntent.mint);

  if (intentFromAddress !== buyerWalletAddress || intentToAddress !== buyerWalletAddress) {
    throw new ServiceError(
      409,
      "The signed wallet intent must come from the wallet linked to your Fortis account.",
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
      nonce: data.transferIntent.nonce,
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
      amount: data.transferIntent.amount,
      from_address: buyerWalletAddress,
      mint: listing.token_mint_address,
      nonce: data.transferIntent.nonce,
      signature: data.transferIntent.signature,
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
  userAuthUserId: string,
): Promise<OrderDto> {
  const user = await requireMarketplaceUser(supabase, userAuthUserId);
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
    order.status !== "Success" &&
    order.status !== "Failed"
  ) {
    try {
      const fortisTransfer = await getFortisTransferRequest(order.fortis_request_id);
      const mappedStatus = mapFortisTransferToOrderUpdate(fortisTransfer);

      const { data: refreshedOrder, error: refreshError } = await supabase
        .from("orders")
        .update({
          error_message: mappedStatus.errorMessage,
          status: mappedStatus.status,
          tx_hash: mappedStatus.txHash,
        })
        .eq("id", order.id)
        .select(ORDER_SELECT)
        .single();

      if (!refreshError) {
        if (!refreshedOrder) {
          throw new ServiceError(500, "Failed to refresh the Fortis order state.");
        }

        order = refreshedOrder;
      } else {
        console.error("Failed to persist refreshed Fortis transfer request", refreshError);
      }
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
  const data = fortisSuccessWebhookSchema.parse(input);

  const { data: updatedOrder, error } = await supabase
    .from("orders")
    .update({
      error_message: null,
      status: normalizeOrderStatus(data.status),
      tx_hash: data.txHash ?? null,
    })
    .eq("id", data.orderId)
    .select(ORDER_SELECT)
    .maybeSingle();

  if (error) {
    throw new ServiceError(500, error.message);
  }

  if (!updatedOrder) {
    throw new ServiceError(404, `Order ${data.orderId} was not found.`);
  }

  return toOrderDto(updatedOrder);
}
