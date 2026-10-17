import { z } from "zod";
import { idSchema, jsonValueSchema, nonEmptyStringSchema, timestampSchema } from "./primitives.js";
import { runtimeStateSchema } from "./runtime.js";

export const messageRoleSchema = z.enum(["SYSTEM", "USER", "ASSISTANT", "TOOL"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageStatusSchema = z.enum(["PENDING", "STREAMING", "COMPLETED", "FAILED", "CANCELLED"]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const messagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TEXT"), text: z.string() }),
  z.object({ type: z.literal("CODE"), language: z.string().max(80), code: z.string(), filePath: z.string().max(16_384).nullable().default(null) }),
  z.object({ type: z.literal("FILE_REFERENCE"), path: z.string().max(16_384), lineStart: z.number().int().positive().nullable().default(null), lineEnd: z.number().int().positive().nullable().default(null) }),
  z.object({ type: z.literal("TOOL_CALL"), invocationId: idSchema, toolId: idSchema, arguments: z.record(z.string(), jsonValueSchema) }),
  z.object({ type: z.literal("TOOL_RESULT"), invocationId: idSchema, resultId: idSchema }),
  z.object({ type: z.literal("STATUS"), state: runtimeStateSchema, label: nonEmptyStringSchema.max(500) }),
  z.object({ type: z.literal("ERROR"), errorId: idSchema }),
]);
export type MessagePart = z.infer<typeof messagePartSchema>;

export const messageSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  executionId: idSchema.nullable().default(null),
  role: messageRoleSchema,
  agentId: idSchema.nullable().default(null),
  sequence: z.number().int().nonnegative(),
  parts: z.array(messagePartSchema),
  status: messageStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  metadata: z.record(z.string(), jsonValueSchema).default({}),
});
export type Message = z.infer<typeof messageSchema>;

export const messageDeltaSchema = z.object({
  messageId: idSchema,
  sequence: z.number().int().nonnegative(),
  partIndex: z.number().int().nonnegative(),
  text: z.string(),
  done: z.boolean().default(false),
  emittedAt: timestampSchema,
});
export type MessageDelta = z.infer<typeof messageDeltaSchema>;
