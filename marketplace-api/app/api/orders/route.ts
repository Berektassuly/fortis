import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/route-errors";
import { createOrder } from "@/lib/services/orders";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const order = await createOrder(payload);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "Failed to create order");
  }
}
