import { z } from "zod";
import { approvalSchema, permissionRequestSchema } from "./permissions.js";
import { contextMetricsSchema, contextSnapshotSchema } from "./context.js";
import { messageDeltaSchema, messageSchema } from "./messages.js";
import { idSchema, nonEmptyStringSchema, nonNegativeIntSchema, timestampSchema } from "./primitives.js";
import { executionSchema, runtimeStateSchema, sessionSchema } from "./runtime.js";
import { toolInvocationSchema, toolResultSchema } from "./tools.js";
import { orderCodeErrorSchema } from "./errors.js";

const eventBaseSchema = {
  id: idSchema,
  sessionId: idSchema,
  executionId: idSchema.nullable().default(null),
  sequence: nonNegativeIntSchema,
  occurredAt: timestampSchema,
};

const eventSchema = <T extends z.ZodTypeAny>(type: string, payload: T) =>
  z.object({ ...eventBaseSchema, type: z.literal(type), payload });

export const eventSchemaUnion = z.discriminatedUnion("type", [
  eventSchema("SESSION_CREATED", sessionSchema),
  eventSchema("SESSION_STATE_CHANGED", z.object({ from: runtimeStateSchema.nullable(), to: runtimeStateSchema, reason: nonEmptyStringSchema.max(2_000) })),
  eventSchema("EXECUTION_STARTED", executionSchema),
  eventSchema("EXECUTION_UPDATED", executionSchema),
  eventSchema("EXECUTION_COMPLETED", executionSchema),
  eventSchema("MESSAGE_CREATED", messageSchema),
  eventSchema("MESSAGE_DELTA", messageDeltaSchema),
  eventSchema("TOOL_REQUESTED", permissionRequestSchema),
  eventSchema("APPROVAL_RESOLVED", approvalSchema),
  eventSchema("TOOL_STARTED", toolInvocationSchema),
  eventSchema("TOOL_COMPLETED", toolResultSchema),
  eventSchema("CONTEXT_UPDATED", contextSnapshotSchema),
  eventSchema("METRICS_UPDATED", contextMetricsSchema),
  eventSchema("ERROR_RAISED", orderCodeErrorSchema),
  eventSchema("CHECKPOINT_CREATED", z.object({ checkpointId: idSchema, sequence: nonNegativeIntSchema })),
  eventSchema("RECOVERY_REQUIRED", z.object({ checkpointId: idSchema.nullable(), reason: nonEmptyStringSchema.max(4_000) })),
]);
export type OrderCodeEvent = z.infer<typeof eventSchemaUnion>;

export const eventBatchSchema = z.object({
  sessionId: idSchema,
  fromSequence: nonNegativeIntSchema,
  toSequence: nonNegativeIntSchema,
  events: z.array(eventSchemaUnion),
  hasMore: z.boolean(),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;
