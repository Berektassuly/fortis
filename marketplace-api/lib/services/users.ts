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

export async function syncSupabaseAuthUser(supabaseUser: Pick<SupabaseUser, "id" | "email">) {
  const email = normalizeEmail(supabaseUser.email);

  return prisma.user.upsert({
    where: {
      email,
    },
    update: {
      email,
    },
    create: {
      email,
    },
  });
}
