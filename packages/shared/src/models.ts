import { z } from "zod";
import {
  idSchema,
  metadataSchema,
  nonEmptyStringSchema,
  nonNegativeIntSchema,
  nonNegativeNumberSchema,
  timestampSchema,
} from "./primitives.js";

export const providerIdSchema = z.enum([
  "OPENROUTER",
  "OPENAI",
  "OPENAI_CHATGPT",
  "ANTHROPIC",
  "XAI",
  "GEMINI",
  "DEEPSEEK",
  "MISTRAL",
  "GROQ",
  "TOGETHER",
  "FIREWORKS",
  "CEREBRAS",
  "OLLAMA",
  "LM_STUDIO",
  "COMPATIBLE_ENDPOINT",
]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const modelAvailabilitySchema = z.enum([
  "AVAILABLE",
  "UNAVAILABLE",
  "UNKNOWN",
  "CONNECTING",
]);
export type ModelAvailability = z.infer<typeof modelAvailabilitySchema>;

export const pricingStatusSchema = z.enum(["EXACT", "ESTIMATED", "UNKNOWN", "FREE"]);
export type PricingStatus = z.infer<typeof pricingStatusSchema>;

export const modelPricingSchema = z.object({
  status: pricingStatusSchema,
  currency: z.literal("USD").default("USD"),
  inputPerMillionUsd: nonNegativeNumberSchema.nullable().default(null),
  outputPerMillionUsd: nonNegativeNumberSchema.nullable().default(null),
  cacheReadPerMillionUsd: nonNegativeNumberSchema.nullable().default(null),
  updatedAt: timestampSchema.nullable().default(null),
});
export type ModelPricing = z.infer<typeof modelPricingSchema>;

export const reasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const modelCapabilitiesSchema = z.object({
  streaming: z.boolean().default(false),
  toolCalling: z.boolean().default(false),
  vision: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  reasoningEfforts: z.array(reasoningEffortSchema).optional(),
  cancellation: z.boolean().default(false),
  contextWindowTokens: nonNegativeIntSchema,
  maxOutputTokens: nonNegativeIntSchema.nullable().default(null),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const modelDescriptorSchema = z.object({
  id: idSchema,
  provider: providerIdSchema,
  name: nonEmptyStringSchema.max(300),
  canonicalName: nonEmptyStringSchema.max(500),
  description: z.string().max(2_000).default(""),
  availability: modelAvailabilitySchema,
  availabilityReason: z.string().max(2_000).optional(),
  local: z.boolean().default(false),
  favorite: z.boolean().default(false),
  capabilities: modelCapabilitiesSchema,
  pricing: modelPricingSchema,
  discoveredAt: timestampSchema,
  metadata: metadataSchema.default({}),
});
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

export const modelSelectionSchema = z.object({
  provider: providerIdSchema,
  modelId: idSchema,
  freeOnly: z.boolean().default(false),
  selectedAt: timestampSchema,
  reasoningEffort: reasoningEffortSchema.optional(),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const providerConnectionStateSchema = z.enum([
  "NOT_CONFIGURED",
  "CONNECTING",
  "CONNECTED",
  "AUTH_REQUIRED",
  "ERROR",
]);
export type ProviderConnectionState = z.infer<typeof providerConnectionStateSchema>;

export const providerConnectionSchema = z.object({
  id: idSchema,
  provider: providerIdSchema,
  displayName: nonEmptyStringSchema.max(200),
  endpoint: z.url().nullable().default(null),
  state: providerConnectionStateSchema,
  supportsStreaming: z.boolean().default(false),
  supportsToolCalling: z.boolean().default(false),
  credentialRef: idSchema.nullable().default(null),
  lastCheckedAt: timestampSchema.nullable().default(null),
  errorId: idSchema.nullable().default(null),
  metadata: metadataSchema.default({}),
});
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
