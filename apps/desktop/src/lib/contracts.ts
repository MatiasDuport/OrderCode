export type WorkMode = 'Plan' | 'Build' | 'Auto';
export type PermissionProfile = 'Lectura' | 'Guiado' | 'Auto' | 'Avanzado';
export interface ExecutionBudget {
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxCostUsd: number | null;
  maxDurationMs: number | null;
  maxToolCalls: number | null;
}
export type RuntimeState =
  | 'CREATED'
  | 'PREPARING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'WAITING_USER'
  | 'PAUSING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RECOVERY_REQUIRED';

export interface SessionConfig {
  projectPath: string;
  model: string;
  providerId?: string;
  modelId?: string;
  freeOnly?: boolean;
  budget?: ExecutionBudget;
  mode: WorkMode;
  permission: PermissionProfile;
}

export interface SessionRecord extends SessionConfig {
  id: string;
  createdAt: string;
  updatedAt?: string;
  state: RuntimeState;
  sequence: number;
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

export interface HarnessEvent {
  id: string;
  sessionId: string;
  sequence: number;
  state: RuntimeState;
  summary: string;
  detail?: string;
  requiresApproval?: boolean;
  runId?: string;
  changedFiles?: string[];
  terminalOutput?: string;
  permissionRequest?: Record<string, unknown>;
  diff?: string;
}

export type PermissionDecision = 'reject' | 'once' | 'session' | 'project';

export interface PermissionEvaluation {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  effect: string;
}

export interface BrokerHealth {
  ok: boolean;
  version: string;
  platform: string;
  harnessConnected: boolean;
}

export interface WorkspaceEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number;
}

export interface CodeSymbol {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'import' | 'text';
  path: string;
  line: number;
  excerpt?: string;
  source?: 'ripgrep' | 'fts5';
}

export interface CodeRelationship {
  kind: 'IMPORTS' | 'CALLS' | 'REFERENCES';
  sourcePath: string;
  sourceName?: string;
  targetPath?: string;
  targetName: string;
  line: number;
  confidence: 'confirmed' | 'inferred';
}

export interface CodeGraphResult {
  query: string;
  files: number;
  symbols: number;
  relationships: CodeRelationship[];
  truncated: boolean;
}

export interface TerminalSessionInfo {
  terminalId: string;
  sessionId: string;
  shell: string;
  cwd: string;
  pid?: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
}

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

export interface AgentToolChoice {
  name: string;
  description: string;
  effects: string[];
}

export interface AgentTestResult {
  content: string;
  providerId: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  toolCallsIgnored: boolean;
}

export type McpTransport = 'stdio' | 'streamable-http';

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

export interface McpMarketplaceOrigin {
  serverName: string;
  publisher: string;
  version: string;
  repository: string;
  registryType: 'npm';
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
