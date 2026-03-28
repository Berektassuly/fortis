import { Prisma } from "@prisma/client";
import type { User as SupabaseUser } from "@supabase/supabase-js";

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/services/service-error";

function normalizeEmail(email: string | null | undefined) {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new ServiceError(400, "The authenticated Supabase user is missing an email address.");
  }

  return normalizedEmail;
}

function isUniqueIdCollision(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    error.meta.target.includes("id")
  );
}

export async function syncSupabaseAuthUser(supabaseUser: Pick<SupabaseUser, "id" | "email">) {
  const email = normalizeEmail(supabaseUser.email);
  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    return prisma.user.update({
      where: {
        id: existingUser.id,
      },
      data: {
        email,
      },
    });
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const highestUser = await prisma.user.findFirst({
      select: {
        id: true,
      },
      orderBy: {
        id: "desc",
      },
    });

    try {
      return await prisma.user.create({
        data: {
          id: (highestUser?.id ?? 0) + 1,
          email,
        },
      });
    } catch (error) {
      if (isUniqueIdCollision(error)) {
        continue;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes("email")
      ) {
        const concurrentUser = await prisma.user.findUnique({
          where: {
            email,
          },
        });

        if (concurrentUser) {
          return concurrentUser;
        }
      }

      throw error;
    }
  }

  throw new ServiceError(500, "Failed to create a marketplace user record after multiple retries.");
}
