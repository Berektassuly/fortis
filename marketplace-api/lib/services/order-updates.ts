import type { SupabaseClient } from "@supabase/supabase-js";

import { toOrderDto, type OrderDto } from "../dto/order.ts";
import type { Database, OrderStatus } from "../supabase/database.types.ts";
import { fortisSuccessWebhookSchema } from "../validators/webhooks.ts";
import type { FortisTransferRequestResult } from "./fortis-client.ts";
import { ServiceError } from "./service-error.ts";

export const NON_TERMINAL_ORDER_STATUSES = ["Created", "Pending", "Processing"] as const;

export type OrderRecord = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "error_message" | "fortis_request_id" | "id" | "listing_id" | "status" | "tx_hash" | "user_id"
>;

export interface OrderStatusUpdate {
  errorMessage: string | null;
  status: OrderStatus;
  txHash: string | null;
}

export function isTerminalOrderStatus(
  status: OrderStatus | null | undefined,
): status is "Failed" | "Success" {
  return status === "Success" || status === "Failed";
}

export function normalizeOrderStatus(status: string | null | undefined): OrderStatus {
  switch (status?.trim().toLowerCase()) {
    case "created":
      return "Created";
    case "pending":
    case "received":
      return "Pending";
    case "pending_submission":
    case "processing":
    case "submitted":
      return "Processing";
    case "completed":
    case "confirmed":
    case "finalized":
    case "success":
      return "Success";
    case "expired":
    case "failed":
    case "rejected":
      return "Failed";
    default:
      return "Pending";
  }
}

export function mapFortisTransferToOrderUpdate(
  transferRequest: FortisTransferRequestResult,
): OrderStatusUpdate {
  const blockchainStatus = transferRequest.blockchain_status?.trim().toLowerCase() ?? "";
  const complianceStatus = transferRequest.compliance_status?.trim().toLowerCase() ?? "";

  if (blockchainStatus === "confirmed" || blockchainStatus === "finalized") {
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
    blockchainStatus === "pending_submission" ||
    blockchainStatus === "processing" ||
    blockchainStatus === "submitted"
  ) {
    return {
      errorMessage: null,
      status: "Processing",
      txHash: transferRequest.blockchain_signature ?? null,
    };
  }

  return {
    errorMessage: null,
    status: "Pending",
    txHash: transferRequest.blockchain_signature ?? null,
  };
}

export function mergeOrderStatusUpdate(
  order: Pick<OrderRecord, "error_message" | "status" | "tx_hash">,
  next: OrderStatusUpdate,
): OrderStatusUpdate {
  const txHash = next.txHash ?? order.tx_hash ?? null;

  if (order.status === "Success") {
    return {
      errorMessage: null,
      status: "Success",
      txHash,
    };
  }

  if (order.status === "Failed") {
    return {
      errorMessage: order.error_message ?? next.errorMessage ?? null,
      status: "Failed",
      txHash,
    };
  }

  return {
    errorMessage: next.status === "Failed" ? next.errorMessage ?? order.error_message ?? null : null,
    status: next.status,
    txHash,
  };
}

export async function persistOrderStatusUpdate(
  supabase: SupabaseClient<Database>,
  existingOrder: OrderRecord,
  incomingUpdate: OrderStatusUpdate,
  orderSelect: string,
): Promise<OrderRecord> {
  const patch = mergeOrderStatusUpdate(existingOrder, incomingUpdate);
  let updateQuery = supabase.from("orders").update({
    error_message: patch.errorMessage,
    status: patch.status,
    tx_hash: patch.txHash,
  });

  updateQuery = updateQuery.eq("id", existingOrder.id);

  if (!isTerminalOrderStatus(existingOrder.status)) {
    updateQuery = updateQuery.in("status", [...NON_TERMINAL_ORDER_STATUSES]);
  }

  const { data: updatedOrderData, error: updateError } = await updateQuery
    .select(orderSelect)
    .maybeSingle();
  const updatedOrder = updatedOrderData as OrderRecord | null;

  if (updateError) {
    throw new ServiceError(500, updateError.message);
  }

  if (updatedOrder) {
    return updatedOrder;
  }

  const { data: currentOrderData, error: currentOrderError } = await supabase
    .from("orders")
    .select(orderSelect)
    .eq("id", existingOrder.id)
    .maybeSingle();
  const currentOrder = currentOrderData as OrderRecord | null;

  if (currentOrderError) {
    throw new ServiceError(500, currentOrderError.message);
  }

  if (!currentOrder) {
    throw new ServiceError(404, `Order ${existingOrder.id} was not found.`);
  }

  return currentOrder;
}

export async function applyFortisWebhookUpdate(
  supabase: SupabaseClient<Database>,
  input: unknown,
  orderSelect: string,
): Promise<OrderDto> {
  const data = fortisSuccessWebhookSchema.parse(input);

  let lookupQuery = supabase.from("orders").select(orderSelect);
  if (data.fortisRequestId) {
    lookupQuery = lookupQuery.eq("fortis_request_id", data.fortisRequestId);
  } else {
    lookupQuery = lookupQuery.eq("id", data.orderId!);
  }

  const { data: existingOrderData, error: orderError } = await lookupQuery.maybeSingle();
  const existingOrder = existingOrderData as OrderRecord | null;

  if (orderError) {
    throw new ServiceError(500, orderError.message);
  }

  if (!existingOrder) {
    const lookupValue = data.fortisRequestId ?? data.orderId;
    throw new ServiceError(404, `Order ${lookupValue} was not found.`);
  }

  const updatedOrder = await persistOrderStatusUpdate(
    supabase,
    existingOrder,
    {
      errorMessage: data.errorMessage,
      status: normalizeOrderStatus(data.status),
      txHash: data.txHash ?? null,
    },
    orderSelect,
  );

  return toOrderDto(updatedOrder);
}
