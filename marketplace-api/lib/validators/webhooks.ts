import { z } from "zod";

const nullableTrimmedString = z.string().trim().min(1).nullable().optional();

export const fortisSuccessWebhookSchema = z
  .object({
    blockchain_signature: nullableTrimmedString,
    blockchain_status: z.string().trim().min(1).optional(),
    blockchainStatus: z.string().trim().min(1).optional(),
    error_message: nullableTrimmedString,
    errorMessage: nullableTrimmedString,
    fortis_request_id: z.string().trim().min(1).optional(),
    fortisRequestId: z.string().trim().min(1).optional(),
    orderId: z.coerce.number().int().positive().optional(),
    status: z.string().trim().min(1).optional(),
    txHash: nullableTrimmedString,
    tx_hash: nullableTrimmedString,
  })
  .superRefine((value, context) => {
    if (!value.orderId && !value.fortisRequestId && !value.fortis_request_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Webhook payload must include orderId or fortisRequestId.",
        path: ["fortisRequestId"],
      });
    }
  })
  .transform((value) => ({
    errorMessage: value.errorMessage ?? value.error_message ?? null,
    fortisRequestId: value.fortisRequestId ?? value.fortis_request_id,
    orderId: value.orderId,
    status: value.blockchainStatus ?? value.blockchain_status ?? value.status ?? "Success",
    txHash: value.txHash ?? value.tx_hash ?? value.blockchain_signature ?? null,
  }));

export type FortisSuccessWebhook = z.infer<typeof fortisSuccessWebhookSchema>;
