import { z } from "zod";
import { idSchema, jsonValueSchema, nonEmptyStringSchema, timestampSchema } from "./primitives.js";

export const errorCodeSchema = z.enum([
  "UNKNOWN",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "CONFLICT",
  "PERMISSION_DENIED",
  "APPROVAL_REQUIRED",
  "CANCELLED",
  "TIMEOUT",
  "UNSUPPORTED",
  "NOT_CONFIGURED",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "TOOL_FAILED",
  "RECOVERY_REQUIRED",
  "SECURITY_VIOLATION",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const orderCodeErrorSchema = z.object({
  id: idSchema,
  code: errorCodeSchema,
  message: nonEmptyStringSchema.max(20_000),
  userMessage: nonEmptyStringSchema.max(20_000),
  retryable: z.boolean().default(false),
  details: z.record(z.string(), jsonValueSchema).default({}),
  causeId: idSchema.nullable().default(null),
  occurredAt: timestampSchema,
});
export type OrderCodeError = z.infer<typeof orderCodeErrorSchema>;

export function isOrderCodeError(value: unknown): value is OrderCodeError {
  return orderCodeErrorSchema.safeParse(value).success;
}
