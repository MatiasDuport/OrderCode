import type { ExecutionBudget } from "@ordercode/shared";
export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export type RunMode = "plan" | "build" | "auto";
export type PermissionProfile = "reading" | "guided" | "auto" | "advanced";
export type RuntimeState =
  | "CREATED"
  | "PREPARING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "WAITING_USER"
  | "PAUSING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "RECOVERY_REQUIRED";
export type ToolEffect = "READ" | "WRITE" | "EXECUTE" | "NETWORK" | "GIT_WRITE" | "PUBLISH" | "DESTRUCTIVE";
export type AgentRole = "general" | "explore" | "architect" | "build" | "debug" | "qa" | "security" | "review";
export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolAllowlist: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface AgentProfileDraft {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  toolAllowlist: string[];
  enabled: boolean;
}

export type McpTransport = "stdio" | "streamable-http";

export interface McpServer {
  id: string;
  projectPath: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args: string[];
  endpoint?: string;
  secretKeys: string[];
  enabled: boolean;
  marketplace?: McpMarketplaceOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerDraft {
  id?: string;
  projectPath: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  endpoint?: string;
  secretKeys?: string[];
  enabled: boolean;
  marketplace?: McpMarketplaceOrigin;
}

export interface McpMarketplaceOrigin {
  serverName: string;
  publisher: string;
  version: string;
  repository: string;
  registryType: "npm";
  packageIdentifier: string;
  packageVersion: string;
}

export interface McpCatalogEntry {
  serverName: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  repository: string;
  packageIdentifier: string;
  packageVersion: string;
  command: string;
  args: string[];
  secretKeys: string[];
  installedVersion?: string;
  updateAvailable: boolean;
}

export interface McpToolSummary {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface McpServerStatus {
  server: McpServer;
  connected: boolean;
  toolCount: number;
  tools: McpToolSummary[];
  error?: string;
}
export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "variable" | "type" | "import" | "text";
  path: string;
  line: number;
  excerpt?: string;
  source?: "ripgrep" | "fts5";
}
export interface CodeRelationship {
  kind: "IMPORTS" | "CALLS" | "REFERENCES";
  sourcePath: string;
  sourceName?: string;
  targetPath?: string;
  targetName: string;
  line: number;
  confidence: "confirmed" | "inferred";
}
export interface CodeIndexedFile {
  path: string;
  hash: string;
  size: number;
  mtimeMs: number;
  symbols: CodeSymbol[];
  relationships: CodeRelationship[];
}
export type PermissionDecision = "reject" | "once" | "session" | "project";
export type ScopeLevel = "user" | "project" | "session" | "agent" | "tool" | "action" | "path" | "destination" | "duration";

export interface SessionRecord {
  id: string;
  projectPath: string;
  title: string;
  modelId?: string;
  providerId?: string;
  freeOnly?: boolean;
  budget?: ExecutionBudget;
  mode: RunMode;
  permissionProfile: PermissionProfile;
  state: RuntimeState;
  createdAt: string;
  updatedAt: string;
  sequence: number;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  runId?: string;
  toolName?: string;
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
}

export interface PermissionRule {
  id: string;
  decision: Exclude<PermissionDecision, "once">;
  effect?: ToolEffect;
  toolName?: string;
  action?: string;
  projectPath?: string;
  pathPrefix?: string;
  destination?: string;
  resource?: string;
  expiresAt?: string;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  action: string;
  effect: ToolEffect;
  resource?: string;
  projectPath: string;
  path?: string;
  destination?: string;
  arguments?: Record<string, unknown>;
  runId?: string;
  reason?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  effects: readonly ToolEffect[];
  cancellable: boolean;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  status: "completed" | "rejected" | "failed" | "cancelled";
  toolName: string;
  exitCode?: number;
  summary: string;
  diagnostics?: string;
  data?: unknown;
  logRef?: string;
  durationMs: number;
}

export interface HarnessEvent {
  protocol: typeof RUNTIME_PROTOCOL_VERSION;
  id: string;
  sessionId: string;
  runId?: string;
  sequence: number;
  type:
    | "session.created"
    | "session.state"
    | "message.created"
    | "run.started"
    | "run.completed"
    | "run.failed"
    | "permission.requested"
    | "permission.resolved"
    | "tool.started"
    | "tool.completed"
    | "provider.chunk"
    | "checkpoint.created";
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface UsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
  costKind?: "exact" | "estimated" | "unknown";
  durationMs: number;
  providerCalls: number;
  toolCalls: number;
  compactions: number;
}

export interface UsageCallRecord {
  id: string;
  sessionId: string;
  projectPath: string;
  runId: string;
  providerId: string;
  modelId: string;
  occurredAt: string;
  localDay: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedSentTokens?: number;
  estimatedSavedTokens?: number;
  providerCalls?: number;
  measuredCalls?: number;
  sourceKind?: "live" | "legacy";
  sourceEventId?: string;
}

export interface UsageAnalyticsQuery {
  projectPath: string;
  days: 7 | 30 | 90 | 0;
  sessionId?: string;
  modelId?: string;
}

export interface UsageAnalytics {
  providerCalls: number;
  measuredCalls: number;
  legacyCalls: number;
  reportedTokenRecords: number;
  activeDays: number;
  firstActivityAt: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  inputTokenRecords: number;
  outputTokenRecords: number;
  cachedTokenRecords: number;
  estimatedSentTokens: number;
  estimatedSavedTokens: number;
  savingsCalls: number;
  untrackedSavingsCalls: number;
  sessions: Array<{ id: string; title: string }>;
  models: string[];
  points: Array<{
    day: string;
    providerCalls: number;
    measuredCalls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedSentTokens: number;
    estimatedSavedTokens: number;
    savingsCalls: number;
  }>;
}

export interface RunResult {
  runId: string;
  session: SessionRecord;
  state: RuntimeState;
  assistantMessage?: MessageRecord;
  toolResults: ToolResult[];
  pendingPermission?: PermissionRequest;
  reason?: string;
  usage: UsageMetrics;
}

export interface ContextInput {
  goal: string;
  includeGoal?: boolean;
  projectPath: string;
  mode: RunMode;
  state: RuntimeState;
  systemInstructions?: string;
  decisions?: string[];
  history?: Array<Pick<MessageRecord, "role" | "content">>;
  fileFragments?: Array<{ path: string; content: string; startLine?: number; endLine?: number; estimatedTokensSaved?: number }>;
  maxChars?: number;
}

export interface BuiltContext {
  text: string;
  included: string[];
  omitted: string[];
  estimatedTokens: number;
  estimatedTokensSaved: number;
}

export interface ProviderModel {
  id: string;
  providerId: string;
  label: string;
  capabilities: string[];
  available: boolean;
  priceKind: "free" | "paid" | "unknown" | "local" | "subscription";
  pricing?: { inputPerMillionUsd: number; outputPerMillionUsd: number; updatedAt: string };
}

export interface CustomProviderConfig { id: string; label: string; baseUrl: string }

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Opaque, provider-issued context needed to continue a stateless tool turn. */
export interface ProviderResponseState {
  responses?: Array<Record<string, unknown>>;
  geminiParts?: Array<Record<string, unknown>>;
  anthropicBlocks?: Array<Record<string, unknown>>;
  reasoningContent?: string;
}

export interface ProviderTurn {
  content: string;
  toolCalls: ProviderToolCall[];
  finishReason: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
  costKind?: "exact" | "estimated" | "unknown";
  raw?: unknown;
  responseState?: ProviderResponseState;
}

export interface ProviderRequest {
  model: string;
  maxOutputTokens?: number;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string; toolName?: string; toolCalls?: ProviderToolCall[]; responseState?: ProviderResponseState }>;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  stream?: boolean;
}

