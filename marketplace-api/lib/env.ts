import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  FORTIS_ENGINE_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  FORTIS_ENGINE_ORDER_PATH: z.string().trim().default("/orders"),
  FORTIS_ENGINE_TOKEN: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  FORTIS_WEBHOOK_SECRET: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

const parsedEnv = serverEnvSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  FORTIS_ENGINE_URL: process.env.FORTIS_ENGINE_URL,
  FORTIS_ENGINE_ORDER_PATH: process.env.FORTIS_ENGINE_ORDER_PATH ?? "/orders",
  FORTIS_ENGINE_TOKEN: process.env.FORTIS_ENGINE_TOKEN,
  FORTIS_WEBHOOK_SECRET: process.env.FORTIS_WEBHOOK_SECRET,
});

if (!parsedEnv.success) {
  throw new Error(`Invalid server environment variables: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
