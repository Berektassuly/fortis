import { Prisma } from "@prisma/client";
import { PublicKey } from "@solana/web3.js";

import { prisma } from "@/lib/prisma";
import { toOrderDto, toOrderResult, type OrderDto, type OrderResult } from "@/lib/dto/order";
import {
  getFortisTransferRequest,
  submitTransferRequestToFortis,
  type FortisTransferRequestResult,
} from "@/lib/services/fortis-client";
import { ServiceError } from "@/lib/services/service-error";
import { createOrderRequestSchema } from "@/lib/validators/orders";
import { fortisSuccessWebhookSchema } from "@/lib/validators/webhooks";

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

function mapFortisTransferToOrderUpdate(transferRequest: FortisTransferRequestResult) {
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
    status: "Pending",
    txHash: transferRequest.blockchain_signature ?? null,
  };
}

export async function createOrder(input: unknown, userId: number): Promise<OrderResult> {
  const data = createOrderRequestSchema.parse(input);

  const [listing, user] = await Promise.all([
    prisma.listing.findUnique({
      where: { id: data.listingId },
      select: {
        id: true,
        ownerId: true,
        priceFiat: true,
        sellerWalletAddress: true,
        tokenMintAddress: true,
        tokenizationStatus: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, solanaWalletAddress: true },
    }),
  ]);

  if (!listing) {
    throw new ServiceError(404, `Listing ${data.listingId} was not found.`);
  }

  if (!user) {
    throw new ServiceError(404, `User ${userId} was not found.`);
  }

  if (!user.solanaWalletAddress) {
    throw new ServiceError(409, "Connect and link your Solana wallet before placing an order.");
  }

  if (!listing.ownerId || !listing.sellerWalletAddress || !listing.tokenMintAddress) {
    throw new ServiceError(409, "This listing is not fully tokenized yet.");
  }

  if (listing.tokenizationStatus !== "active") {
    throw new ServiceError(409, "This listing is still being prepared for trading.");
  }

  if (listing.ownerId === user.id) {
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

  if (intentMint !== listing.tokenMintAddress) {
    throw new ServiceError(400, "The signed mint does not match this listing.");
  }

  if (data.transferIntent.amount !== 1) {
    throw new ServiceError(400, "This demo purchase flow currently transfers exactly 1 asset token.");
  }

  let order: Awaited<ReturnType<typeof prisma.order.create>> | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const highestOrder = await prisma.order.findFirst({
      select: {
        id: true,
      },
      orderBy: {
        id: "desc",
      },
    });

    try {
      order = await prisma.order.create({
        data: {
          id: (highestOrder?.id ?? 0) + 1,
          listingId: listing.id,
          userId: user.id,
          buyerWalletAddress,
          nonce: data.transferIntent.nonce,
          sellerWalletAddress: listing.sellerWalletAddress,
          status: "Pending",
          tokenMintAddress: listing.tokenMintAddress,
        },
      });
      break;
    } catch (error) {
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

  if (!order) {
    throw new ServiceError(500, "Failed to create order after multiple retries.");
  }

  try {
    const fortisTransfer = await submitTransferRequestToFortis({
      amount: data.transferIntent.amount,
      from_address: buyerWalletAddress,
      mint: listing.tokenMintAddress,
      nonce: data.transferIntent.nonce,
      signature: data.transferIntent.signature,
      source_owner_address: listing.sellerWalletAddress,
      to_address: buyerWalletAddress,
    });

    const mappedStatus = mapFortisTransferToOrderUpdate(fortisTransfer);
    const updatedOrder = await prisma.order.update({
      where: {
        id: order.id,
      },
      data: {
        errorMessage: mappedStatus.errorMessage,
        fortisRequestId: fortisTransfer.id,
        status: mappedStatus.status,
        txHash: mappedStatus.txHash,
      },
    });

    return toOrderResult(updatedOrder, true, fortisTransfer.id);
  } catch (error) {
    console.error("Failed to dispatch Fortis order intent", error);

    const failedOrder = await prisma.order.update({
      where: {
        id: order.id,
      },
      data: {
        errorMessage: error instanceof Error ? error.message : "Failed to submit the purchase intent.",
        status: "Failed",
      },
    });

    return toOrderResult(failedOrder, false, null);
  }
}

export async function getOrderForUser(orderId: number, userId: number): Promise<OrderDto> {
  let order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
    },
  });

  if (!order) {
    throw new ServiceError(404, `Order ${orderId} was not found.`);
  }

  if (order.fortisRequestId && order.status !== "Success" && order.status !== "Failed") {
    try {
      const fortisTransfer = await getFortisTransferRequest(order.fortisRequestId);
      const mappedStatus = mapFortisTransferToOrderUpdate(fortisTransfer);

      order = await prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          errorMessage: mappedStatus.errorMessage,
          status: mappedStatus.status,
          txHash: mappedStatus.txHash,
        },
      });
    } catch (error) {
      console.error("Failed to refresh Fortis transfer request", error);
    }
  }

  return toOrderDto(order);
}

export async function applyFortisSuccessWebhook(input: unknown): Promise<OrderDto> {
  const data = fortisSuccessWebhookSchema.parse(input);

  const existingOrder = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: { id: true },
  });

  if (!existingOrder) {
    throw new ServiceError(404, `Order ${data.orderId} was not found.`);
  }

  const updatedOrder = await prisma.order.update({
    where: {
      id: data.orderId,
    },
    data: {
      errorMessage: null,
      status: data.status,
      txHash: data.txHash ?? null,
    },
  });

  return toOrderDto(updatedOrder);
}
