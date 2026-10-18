import { z } from "zod";
import {
  idSchema,
  metadataSchema,
  nonEmptyStringSchema,
  nonNegativeIntSchema,
  nonNegativeNumberSchema,
  pathSchema,
  timestampSchema,
} from "./primitives.js";
import type { JsonValue } from "./primitives.js";

export const runtimeStateSchema = z.enum([
  "CREATED",
  "PREPARING",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_USER",
  "PAUSING",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "RECOVERY_REQUIRED",
]);
export type RuntimeState = z.infer<typeof runtimeStateSchema>;

export const workModeSchema = z.enum(["PLAN", "BUILD", "AUTO"]);
export type WorkMode = z.infer<typeof workModeSchema>;

export const executionOutcomeSchema = z.enum([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
  "RECOVERY_REQUIRED",
]);
export type ExecutionOutcome = z.infer<typeof executionOutcomeSchema>;

export const specialistRoleSchema = z.enum([
  "GENERAL",
  "EXPLORE",
  "ARCHITECT",
  "BUILD",
  "DEBUG",
  "QA",
  "SECURITY",
  "REVIEW",
]);
export type SpecialistRole = z.infer<typeof specialistRoleSchema>;

export const projectSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema.max(200),
  rootPath: pathSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  metadata: metadataSchema.default({}),
});
export type Project = z.infer<typeof projectSchema>;

export const sessionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  title: nonEmptyStringSchema.max(300),
  mode: workModeSchema,
  modelId: idSchema.nullable(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  permissionProfile: z.enum(["READ_ONLY", "GUIDED", "AUTO", "ADVANCED"]),
  state: runtimeStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastEventSequence: nonNegativeIntSchema.default(0),
  activeExecutionId: idSchema.nullable().default(null),
  metadata: metadataSchema.default({}),
});
export type Session = z.infer<typeof sessionSchema>;

export const executionBudgetSchema = z.object({
  maxInputTokens: nonNegativeIntSchema.nullable().default(null),
  maxOutputTokens: nonNegativeIntSchema.nullable().default(null),
  maxCostUsd: nonNegativeNumberSchema.nullable().default(null),
  maxDurationMs: nonNegativeIntSchema.nullable().default(null),
  maxToolCalls: nonNegativeIntSchema.nullable().default(null),
});
export type ExecutionBudget = z.infer<typeof executionBudgetSchema>;

export const executionUsageSchema = z.object({
  inputTokens: nonNegativeIntSchema.default(0),
  outputTokens: nonNegativeIntSchema.default(0),
  cachedTokens: nonNegativeIntSchema.default(0),
  costUsd: nonNegativeNumberSchema.nullable().default(null),
  durationMs: nonNegativeIntSchema.default(0),
  toolCalls: nonNegativeIntSchema.default(0),
});
export type ExecutionUsage = z.infer<typeof executionUsageSchema>;

export const executionSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  mode: workModeSchema,
  state: runtimeStateSchema,
  outcome: executionOutcomeSchema.nullable().default(null),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable().default(null),
  currentAgentId: idSchema.nullable().default(null),
  budget: executionBudgetSchema,
  usage: executionUsageSchema,
  checkpointId: idSchema.nullable().default(null),
  errorId: idSchema.nullable().default(null),
  metadata: metadataSchema.default({}),
});
export type Execution = z.infer<typeof executionSchema>;

export const agentConfigSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema.max(120),
  role: specialistRoleSchema,
  description: nonEmptyStringSchema.max(1_000),
  instructions: nonEmptyStringSchema.max(50_000),
  enabled: z.boolean().default(true),
  toolIds: z.array(idSchema).max(500).default([]),
  skillIds: z.array(idSchema).max(500).default([]),
  mcpServerIds: z.array(idSchema).max(500).default([]),
  permissionProfile: z.enum(["READ_ONLY", "GUIDED", "AUTO", "ADVANCED"]),
  metadata: metadataSchema.default({}),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const agentRunSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  agentId: idSchema,
  role: specialistRoleSchema,
  task: nonEmptyStringSchema.max(20_000),
  state: runtimeStateSchema,
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable().default(null),
  result: z.string().max(100_000).nullable().default(null),
  errorId: idSchema.nullable().default(null),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

export const checkpointSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  executionId: idSchema.nullable().default(null),
  sequence: nonNegativeIntSchema,
  createdAt: timestampSchema,
  state: runtimeStateSchema,
  durableEventSequence: nonNegativeIntSchema,
  openProcessIds: z.array(idSchema).default([]),
  pendingApprovalIds: z.array(idSchema).default([]),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

export type RuntimePayload = JsonValue;
