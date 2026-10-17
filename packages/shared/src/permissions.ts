import { z } from "zod";
import {
  idSchema,
  jsonValueSchema,
  metadataSchema,
  nonEmptyStringSchema,
  pathSchema,
  timestampSchema,
} from "./primitives.js";

export const permissionProfileSchema = z.enum(["READ_ONLY", "GUIDED", "AUTO", "ADVANCED"]);
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;

export const toolEffectSchema = z.enum([
  "READ",
  "WRITE",
  "EXECUTE",
  "NETWORK",
  "GIT_WRITE",
  "PUBLISH",
  "DESTRUCTIVE",
]);
export type ToolEffect = z.infer<typeof toolEffectSchema>;

export const permissionScopeSchema = z.enum([
  "USER",
  "PROJECT",
  "SESSION",
  "AGENT",
  "TOOL",
  "ACTION",
  "PATH",
  "DESTINATION",
  "DURATION",
]);
export type PermissionScope = z.infer<typeof permissionScopeSchema>;

export const approvalDecisionSchema = z.enum([
  "REJECT",
  "ALLOW_ONCE",
  "ALLOW_SESSION",
  "CREATE_PROJECT_RULE",
]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const permissionDurationSchema = z.enum(["ONCE", "SESSION", "PROJECT", "UNTIL"]);
export type PermissionDuration = z.infer<typeof permissionDurationSchema>;

export const permissionGrantSchema = z.object({
  id: idSchema,
  profile: permissionProfileSchema,
  scopes: z.array(permissionScopeSchema).min(1),
  effects: z.array(toolEffectSchema).min(1),
  toolId: idSchema.nullable().default(null),
  action: nonEmptyStringSchema.max(300).nullable().default(null),
  projectId: idSchema.nullable().default(null),
  sessionId: idSchema.nullable().default(null),
  agentId: idSchema.nullable().default(null),
  path: pathSchema.nullable().default(null),
  destination: z.string().max(2_000).nullable().default(null),
  duration: permissionDurationSchema,
  expiresAt: timestampSchema.nullable().default(null),
  singleUse: z.boolean().default(false),
  createdAt: timestampSchema,
  metadata: metadataSchema.default({}),
});
export type PermissionGrant = z.infer<typeof permissionGrantSchema>;

export const permissionRequestSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  executionId: idSchema,
  agentId: idSchema.nullable().default(null),
  toolId: idSchema,
  action: nonEmptyStringSchema.max(300),
  effects: z.array(toolEffectSchema).min(1),
  resource: nonEmptyStringSchema.max(4_000),
  path: pathSchema.nullable().default(null),
  destination: z.string().max(2_000).nullable().default(null),
  risk: riskLevelSchema,
  arguments: z.record(z.string(), jsonValueSchema).default({}),
  requestedAt: timestampSchema,
  expiresAt: timestampSchema.nullable().default(null),
});
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;

export const approvalSchema = z.object({
  id: idSchema,
  requestId: idSchema,
  decision: approvalDecisionSchema,
  grantId: idSchema.nullable().default(null),
  decidedAt: timestampSchema,
  decidedBy: z.enum(["USER", "POLICY", "SYSTEM"]),
  note: z.string().max(2_000).default(""),
});
export type Approval = z.infer<typeof approvalSchema>;

export const permissionEvaluationSchema = z.object({
  allowed: z.boolean(),
  requiresApproval: z.boolean(),
  matchedGrantId: idSchema.nullable().default(null),
  reason: nonEmptyStringSchema.max(2_000),
  effectiveEffects: z.array(toolEffectSchema),
});
export type PermissionEvaluation = z.infer<typeof permissionEvaluationSchema>;
