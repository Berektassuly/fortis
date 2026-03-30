import { NextResponse } from "next/server";
import { AuthError } from "@supabase/supabase-js";
import { ZodError } from "zod";

import { ServiceError } from "@/lib/services/service-error";

interface PostgrestLikeError {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message: string;
}

function isPostgrestLikeError(error: unknown): error is PostgrestLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

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

  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (isPostgrestLikeError(error)) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error: "A database uniqueness constraint was violated.",
        },
        { status: 409 },
      );
    }
  }

  console.error(error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
