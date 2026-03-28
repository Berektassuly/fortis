import { prisma } from "@/lib/prisma";
import { toOrderDto, toOrderResult, type OrderDto, type OrderResult } from "@/lib/dto/order";
import { dispatchOrderIntentToFortis } from "@/lib/services/fortis-client";
import { ServiceError } from "@/lib/services/service-error";
import { createOrderRequestSchema } from "@/lib/validators/orders";
import { fortisSuccessWebhookSchema } from "@/lib/validators/webhooks";

export async function createOrder(input: unknown): Promise<OrderResult> {
  const data = createOrderRequestSchema.parse(input);

  const [listing, user] = await Promise.all([
    prisma.listing.findUnique({
      where: { id: data.listingId },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true },
    }),
  ]);

  if (!listing) {
    throw new ServiceError(404, `Listing ${data.listingId} was not found.`);
  }

  if (!user) {
    throw new ServiceError(404, `User ${data.userId} was not found.`);
  }

  const order = await prisma.order.create({
    data: {
      listingId: listing.id,
      userId: user.id,
      status: "Created",
    },
  });

  try {
    const bridgeResult = await dispatchOrderIntentToFortis({
      orderId: order.id,
      listingId: listing.id,
      userId: user.id,
    });

    return toOrderResult(order, bridgeResult.dispatched, bridgeResult.reference);
  } catch (error) {
    console.error("Failed to dispatch Fortis order intent", error);
    return toOrderResult(order, false, null);
  }
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
      status: data.status,
      txHash: data.txHash ?? null,
    },
  });

  return toOrderDto(updatedOrder);
}
