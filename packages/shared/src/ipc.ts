import { z } from "zod";
import { orderCodeErrorSchema } from "./errors.js";
import { eventSchemaUnion } from "./events.js";
import { idSchema, jsonValueSchema, nonEmptyStringSchema, nonNegativeIntSchema, timestampSchema } from "./primitives.js";

// The desktop bridge uses JSON-RPC over Tauri's private stdin/stdout broker.
// Keep that existing wire format validated here instead of duplicating its shape.
export const harnessRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().min(1).max(128), z.number().finite(), z.null()]).optional(),
  method: nonEmptyStringSchema.max(200),
  params: z.record(z.string(), jsonValueSchema).optional(),
});
export type HarnessRpcRequest = z.infer<typeof harnessRpcRequestSchema>;

export const protocolVersionSchema = z.string().regex(/^v[0-9]+$/);
export const ipcMethodSchema = z.enum([
  "health.get",
  "project.list",
  "project.open",
  "session.create",
  "session.get",
  "session.list",
  "session.send",
  "session.pause",
  "session.resume",
  "session.cancel",
  "execution.approve",
  "tool.list",
  "model.list",
  "model.select",
  "permission.evaluate",
  "events.subscribe",
  "events.replay",
]);
export type IpcMethod = z.infer<typeof ipcMethodSchema>;

export const ipcRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: idSchema,
  method: ipcMethodSchema,
  sessionId: idSchema.nullable().default(null),
  payload: jsonValueSchema,
  sentAt: timestampSchema,
  traceId: idSchema.nullable().default(null),
});
export type IpcRequest = z.infer<typeof ipcRequestSchema>;

export const ipcSuccessSchema = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: idSchema,
  ok: z.literal(true),
  data: jsonValueSchema,
  respondedAt: timestampSchema,
});

export const ipcFailureSchema = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: idSchema,
  ok: z.literal(false),
  error: orderCodeErrorSchema,
  respondedAt: timestampSchema,
});

export const ipcResponseSchema = z.discriminatedUnion("ok", [ipcSuccessSchema, ipcFailureSchema]);
export type IpcResponse = z.infer<typeof ipcResponseSchema>;

export const ipcEventSchema = z.object({
  protocolVersion: protocolVersionSchema,
  event: eventSchemaUnion,
  emittedAt: timestampSchema,
});
export type IpcEvent = z.infer<typeof ipcEventSchema>;

export const ipcCancelRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: idSchema,
  reason: nonEmptyStringSchema.max(2_000).default("User requested cancellation"),
  sentAt: timestampSchema,
});
export type IpcCancelRequest = z.infer<typeof ipcCancelRequestSchema>;

export const eventSubscriptionSchema = z.object({
  sessionId: idSchema,
  afterSequence: nonNegativeIntSchema.default(0),
  includeHistorical: z.boolean().default(true),
});
export type EventSubscription = z.infer<typeof eventSubscriptionSchema>;

export const protocolHelloSchema = z.object({
  protocolVersion: protocolVersionSchema,
  client: nonEmptyStringSchema.max(100),
  clientVersion: nonEmptyStringSchema.max(100),
  supportedEventVersion: protocolVersionSchema,
  nonce: idSchema,
});
export type ProtocolHello = z.infer<typeof protocolHelloSchema>;
