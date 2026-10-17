import { z } from "zod";
import { idSchema, jsonValueSchema, metadataSchema, nonEmptyStringSchema, nonNegativeIntSchema, timestampSchema } from "./primitives.js";
import { toolEffectSchema } from "./permissions.js";

export const toolInputSchemaSchema = z.record(z.string(), jsonValueSchema);

export const toolDefinitionSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema.max(200),
  description: nonEmptyStringSchema.max(10_000),
  version: nonEmptyStringSchema.max(100),
  effects: z.array(toolEffectSchema).min(1),
  capabilities: z.array(nonEmptyStringSchema.max(200)).default([]),
  inputSchema: toolInputSchemaSchema,
  cancelable: z.boolean().default(false),
  idempotent: z.boolean().default(false),
  sensitive: z.boolean().default(false),
  source: z.enum(["BUILT_IN", "MCP", "SKILL", "EXTENSION"]).default("BUILT_IN"),
  metadata: metadataSchema.default({}),
});
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

export const toolInvocationStatusSchema = z.enum(["REQUESTED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED"]);
export type ToolInvocationStatus = z.infer<typeof toolInvocationStatusSchema>;

export const toolDiagnosticSchema = z.object({
  severity: z.enum(["INFO", "WARNING", "ERROR"]),
  message: nonEmptyStringSchema.max(10_000),
  filePath: z.string().max(16_384).nullable().default(null),
  line: nonNegativeIntSchema.nullable().default(null),
  column: nonNegativeIntSchema.nullable().default(null),
  code: z.string().max(200).nullable().default(null),
});
export type ToolDiagnostic = z.infer<typeof toolDiagnosticSchema>;

export const evidenceReferenceSchema = z.object({
  id: idSchema,
  kind: z.enum(["FILE", "LOG", "DIFF", "TEST", "PROCESS", "URL", "CHECKPOINT"]),
  label: nonEmptyStringSchema.max(500),
  ref: nonEmptyStringSchema.max(16_384),
  verified: z.boolean().default(false),
});
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

export const toolInvocationSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  agentId: idSchema.nullable().default(null),
  toolId: idSchema,
  arguments: toolInputSchemaSchema,
  status: toolInvocationStatusSchema,
  requestedAt: timestampSchema,
  startedAt: timestampSchema.nullable().default(null),
  finishedAt: timestampSchema.nullable().default(null),
  permissionRequestId: idSchema.nullable().default(null),
});
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;

export const toolResultSchema = z.object({
  id: idSchema,
  invocationId: idSchema,
  status: toolInvocationStatusSchema,
  exitCode: z.number().int().nullable().default(null),
  diagnostics: z.array(toolDiagnosticSchema).default([]),
  summary: z.string().max(20_000),
  output: jsonValueSchema.nullable().default(null),
  logRef: nonEmptyStringSchema.max(16_384).nullable().default(null),
  evidence: z.array(evidenceReferenceSchema).default([]),
  startedAt: timestampSchema,
  finishedAt: timestampSchema,
  metadata: metadataSchema.default({}),
});
export type ToolResult = z.infer<typeof toolResultSchema>;
