import { Prisma } from "@prisma/client";
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

  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    const message = error.message.toLowerCase();

    if (message.includes("prepared statement") && message.includes("already exists")) {
      return NextResponse.json(
        {
          error:
            "Database pooler configuration is invalid for Prisma. Use the Supabase pooler URL with pgbouncer=true&connection_limit=1.",
        },
        { status: 503 },
      );
    }
  }

  console.error(error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
