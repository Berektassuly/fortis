import { z } from "zod";

const serverEnvSchema = z.object({
  FORTIS_ENGINE_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  FORTIS_ENGINE_ORDER_PATH: z.string().trim().default("/orders"),
  FORTIS_ENGINE_TOKENIZE_PATH: z.string().trim().default("/listings/tokenize"),
  FORTIS_ENGINE_TRANSFER_REQUEST_PATH: z.string().trim().default("/transfer-requests"),
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
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

const parsedEnv = serverEnvSchema.safeParse({
  FORTIS_ENGINE_URL: process.env.FORTIS_ENGINE_URL,
  FORTIS_ENGINE_ORDER_PATH: process.env.FORTIS_ENGINE_ORDER_PATH ?? "/orders",
  FORTIS_ENGINE_TOKENIZE_PATH:
    process.env.FORTIS_ENGINE_TOKENIZE_PATH ?? "/listings/tokenize",
  FORTIS_ENGINE_TRANSFER_REQUEST_PATH:
    process.env.FORTIS_ENGINE_TRANSFER_REQUEST_PATH ?? "/transfer-requests",
  FORTIS_ENGINE_TOKEN: process.env.FORTIS_ENGINE_TOKEN,
  FORTIS_WEBHOOK_SECRET: process.env.FORTIS_WEBHOOK_SECRET,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

if (!parsedEnv.success) {
  throw new Error(`Invalid server environment variables: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
