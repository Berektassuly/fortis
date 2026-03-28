import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ServiceError } from "@/lib/services/service-error";

export function toErrorResponse(error: unknown, fallbackMessage = "Internal server error") {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Invalid request payload",
        details: error.flatten(),
      },
      { status: 400 },
    );
  }

  if (error instanceof ServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  console.error(error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
