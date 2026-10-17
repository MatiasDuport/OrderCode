import { z } from "zod";
import { idSchema, nonEmptyStringSchema, nonNegativeIntSchema, nonNegativeNumberSchema, timestampSchema } from "./primitives.js";

export const metricCertaintySchema = z.enum(["EXACT", "ESTIMATED", "UNKNOWN"]);
export type MetricCertainty = z.infer<typeof metricCertaintySchema>;

export const tokenUsageSchema = z.object({
  input: nonNegativeIntSchema.default(0),
  output: nonNegativeIntSchema.default(0),
  cached: nonNegativeIntSchema.default(0),
  certainty: metricCertaintySchema.default("EXACT"),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const costUsageSchema = z.object({
  amountUsd: nonNegativeNumberSchema.nullable().default(null),
  certainty: metricCertaintySchema,
});
export type CostUsage = z.infer<typeof costUsageSchema>;

export const contextMetricsSchema = z.object({
  tokens: tokenUsageSchema,
  cost: costUsageSchema,
  elapsedMs: nonNegativeIntSchema.default(0),
  toolCalls: nonNegativeIntSchema.default(0),
  rereads: nonNegativeIntSchema.default(0),
  compactions: nonNegativeIntSchema.default(0),
  retries: nonNegativeIntSchema.default(0),
  contextItems: nonNegativeIntSchema.default(0),
  measuredAt: timestampSchema,
});
export type ContextMetrics = z.infer<typeof contextMetricsSchema>;

export const contextReferenceSchema = z.object({
  id: idSchema,
  kind: z.enum(["OBJECTIVE", "DECISION", "HISTORY", "FILE", "SYMBOL", "TOOL", "EVIDENCE", "ERROR", "CHECKPOINT"]),
  label: nonEmptyStringSchema.max(500),
  source: nonEmptyStringSchema.max(16_384),
  relevance: z.number().finite().min(0).max(1),
  required: z.boolean().default(false),
});
export type ContextReference = z.infer<typeof contextReferenceSchema>;

export const contextSnapshotSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  executionId: idSchema,
  objective: nonEmptyStringSchema.max(20_000),
  stateSummary: nonEmptyStringSchema.max(20_000),
  references: z.array(contextReferenceSchema),
  metrics: contextMetricsSchema,
  createdAt: timestampSchema,
});
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;

export const compactionModeSchema = z.enum(["MANUAL", "AUTO", "CONSERVATIVE"]);
export type CompactionMode = z.infer<typeof compactionModeSchema>;

export const compactionRequestSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  executionId: idSchema,
  mode: compactionModeSchema,
  reason: z.enum(["PRESSURE", "REDUNDANCY", "COST", "USER_REQUEST", "RECOVERY"]),
  preserve: z.array(z.enum(["OBJECTIVES", "DECISIONS", "CHANGES", "ERRORS", "TESTS", "REFERENCES"])).min(1),
  createdAt: timestampSchema,
});
export type CompactionRequest = z.infer<typeof compactionRequestSchema>;
