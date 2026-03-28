import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as {
  prisma?: PrismaClient;
};

function normalizeDatabaseUrl(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname.includes("pooler.supabase.com")) {
      if (!parsedUrl.searchParams.has("pgbouncer")) {
        parsedUrl.searchParams.set("pgbouncer", "true");
      }

      if (!parsedUrl.searchParams.has("connection_limit")) {
        parsedUrl.searchParams.set("connection_limit", "1");
      }

      return parsedUrl.toString();
    }
  } catch (error) {
    console.error("Failed to normalize DATABASE_URL", error);
  }

  return url;
}

const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: databaseUrl
      ? {
          db: {
            url: databaseUrl,
          },
        }
      : undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
