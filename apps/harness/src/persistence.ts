import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { AgentProfile, CodeIndexedFile, CodeRelationship, CodeSymbol, CustomProviderConfig, HarnessEvent, McpServer, MessageRecord, PermissionRequest, PermissionRule, ProviderToolCall, SessionRecord, UsageAnalytics, UsageAnalyticsQuery, UsageCallRecord } from "./types.js";

export function defaultDataDirectory(): string {
  if (process.env.ORDERCODE_DATA_DIR) return process.env.ORDERCODE_DATA_DIR;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "OrderCode");
  if (process.platform === "darwin" && process.env.HOME) return join(process.env.HOME, "Library", "Application Support", "OrderCode");
  return join(homedir(), ".ordercode");
}

export interface Persistence {
  listAgentProfiles(): AgentProfile[];
  getAgentProfile(id: string): AgentProfile | undefined;
  saveAgentProfile(profile: AgentProfile): void;
  deleteAgentProfile(id: string): boolean;
  listMcpServers(projectPath?: string): McpServer[];
  listCustomProviders(): CustomProviderConfig[];
  saveCustomProvider(provider: CustomProviderConfig): void;
  deleteCustomProvider(id: string): boolean;
  getMcpServer(id: string): McpServer | undefined;
  saveMcpServer(server: McpServer): void;
  deleteMcpServer(id: string): boolean;
  listCodeIndexFiles(projectPath: string): CodeIndexedFile[];
  upsertCodeIndexFile(projectPath: string, file: CodeIndexedFile, content: string): void;
  deleteCodeIndexFiles(projectPath: string, paths: string[]): void;
  searchCodeText(projectPath: string, query: string, limit?: number): Array<{ path: string; line: number; excerpt: string }>;
  createSession(input: Omit<SessionRecord, "createdAt" | "updatedAt" | "sequence">): SessionRecord;
  getSession(id: string): SessionRecord | undefined;
  listSessions(projectPath?: string, limit?: number): SessionRecord[];
  updateSession(id: string, patch: Partial<Pick<SessionRecord, "title" | "modelId" | "providerId" | "freeOnly" | "budget" | "reasoningEffort" | "mode" | "permissionProfile" | "state">>): SessionRecord;
  listMessages(sessionId: string, limit?: number): MessageRecord[];
  appendMessage(message: MessageRecord): void;
  appendEvent(event: HarnessEvent): void;
  listEvents(sessionId: string, afterSequence?: number, limit?: number): HarnessEvent[];
  recordUsageCall(record: UsageCallRecord): void;
  getUsageAnalytics(query: UsageAnalyticsQuery): UsageAnalytics;
  addPermissionRule(rule: PermissionRule): void;
  listPermissionRules(projectPath?: string): PermissionRule[];
  addPermissionRequest(request: PermissionRequest): void;
  resolvePermissionRequest(id: string, decision: string): void;
  listPendingPermissionRequests(): PermissionRequest[];
  listEnabledSkills(projectPath: string): string[];
  setEnabledSkills(projectPath: string, skillPaths: string[]): void;
  saveCheckpoint(sessionId: string, checkpoint: unknown): void;
  getCheckpoint(sessionId: string): unknown | undefined;
  deleteCheckpoint(sessionId: string): void;
  close(): void;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function localDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString("en-CA");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayKeyOffset(daysAgo: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return localDayKey(date);
}

function safeCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export class SqlitePersistence implements Persistence {
  readonly directory: string;
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(directory = defaultDataDirectory()) {
    this.directory = directory;
    this.databasePath = join(directory, "runtime.sqlite3");
    // DatabaseSync is deliberately used behind this narrow interface. The runtime performs short
    // indexed operations and keeps all long work asynchronous, so the UI process is not blocked by IO.
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const previousVersion = Number((this.db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)?.user_version ?? 0);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, project_path TEXT NOT NULL, title TEXT NOT NULL,
        model_id TEXT, provider_id TEXT, free_only INTEGER NOT NULL DEFAULT 0, budget_json TEXT NOT NULL DEFAULT '{}', mode TEXT NOT NULL, permission_profile TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sequence INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, run_id TEXT, tool_name TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_session_created ON messages(session_id, created_at);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL, created_at TEXT NOT NULL, type TEXT NOT NULL, run_id TEXT, payload TEXT NOT NULL,
        UNIQUE(session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS events_session_sequence ON events(session_id, sequence);
      CREATE TABLE IF NOT EXISTS usage_calls (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project_path TEXT NOT NULL, run_id TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL, local_day TEXT NOT NULL,
        input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER,
        estimated_sent_tokens INTEGER, estimated_saved_tokens INTEGER,
        provider_calls INTEGER NOT NULL DEFAULT 1, measured_calls INTEGER NOT NULL DEFAULT 0,
        source_kind TEXT NOT NULL DEFAULT 'live', source_event_id TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS usage_calls_project_day ON usage_calls(project_path, local_day);
      CREATE INDEX IF NOT EXISTS usage_calls_session_day ON usage_calls(session_id, local_day);
      CREATE INDEX IF NOT EXISTS usage_calls_project_model_day ON usage_calls(project_path, model_id, local_day);
      CREATE TABLE IF NOT EXISTS permission_rules (id TEXT PRIMARY KEY, payload TEXT NOT NULL, project_path TEXT);
      CREATE INDEX IF NOT EXISTS permission_rules_project ON permission_rules(project_path);
      CREATE TABLE IF NOT EXISTS permission_requests (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL, decision TEXT);
      CREATE TABLE IF NOT EXISTS runtime_checkpoints (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS active_project_skills (project_path TEXT NOT NULL, skill_path TEXT NOT NULL, PRIMARY KEY(project_path, skill_path));
      CREATE TABLE IF NOT EXISTS agent_profiles (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, project_path TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mcp_servers_project ON mcp_servers(project_path, updated_at);
      CREATE TABLE IF NOT EXISTS custom_providers (id TEXT PRIMARY KEY, label TEXT NOT NULL, base_url TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS code_index_files (project_path TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, mtime_ms REAL NOT NULL, symbols TEXT NOT NULL, PRIMARY KEY(project_path, path));
      CREATE INDEX IF NOT EXISTS code_index_project_path ON code_index_files(project_path, path);
      CREATE VIRTUAL TABLE IF NOT EXISTS code_index_lines USING fts5(project_path UNINDEXED, path UNINDEXED, line UNINDEXED, content, tokenize='unicode61');
    `);
    const sessionColumns = new Set((this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!sessionColumns.has("free_only")) this.db.exec("ALTER TABLE sessions ADD COLUMN free_only INTEGER NOT NULL DEFAULT 0");
    if (!sessionColumns.has("reasoning_effort")) this.db.exec("ALTER TABLE sessions ADD COLUMN reasoning_effort TEXT");
    if (!sessionColumns.has("budget_json")) this.db.exec("ALTER TABLE sessions ADD COLUMN budget_json TEXT NOT NULL DEFAULT '{}'");
    const messageColumns = new Set((this.db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!messageColumns.has("tool_call_id")) this.db.exec("ALTER TABLE messages ADD COLUMN tool_call_id TEXT");
    if (!messageColumns.has("tool_calls")) this.db.exec("ALTER TABLE messages ADD COLUMN tool_calls TEXT");
    if (previousVersion < 8) this.backfillCompletedRunUsage();
    this.db.exec("PRAGMA user_version = 8;");
  }

  static async open(directory = defaultDataDirectory()): Promise<SqlitePersistence> {
    await mkdir(directory, { recursive: true });
    return new SqlitePersistence(directory);
  }

  listAgentProfiles(): AgentProfile[] {
    const rows = this.db.prepare("SELECT payload FROM agent_profiles ORDER BY updated_at DESC").all() as Array<{ payload: string }>;
    return rows.map((row) => parseJson<AgentProfile>(row.payload));
  }

  getAgentProfile(id: string): AgentProfile | undefined {
    const row = this.db.prepare("SELECT payload FROM agent_profiles WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? parseJson<AgentProfile>(row.payload) : undefined;
  }

  saveAgentProfile(profile: AgentProfile): void {
    this.db.prepare("INSERT INTO agent_profiles (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at")
      .run(profile.id, JSON.stringify(profile), profile.updatedAt);
  }

  deleteAgentProfile(id: string): boolean {
    return this.db.prepare("DELETE FROM agent_profiles WHERE id = ?").run(id).changes > 0;
  }

  listMcpServers(projectPath?: string): McpServer[] {
    const rows = projectPath
      ? this.db.prepare("SELECT payload FROM mcp_servers WHERE project_path = ? ORDER BY updated_at DESC").all(projectPath)
      : this.db.prepare("SELECT payload FROM mcp_servers ORDER BY updated_at DESC").all();
    return (rows as Array<{ payload: string }>).map((row) => parseJson<McpServer>(row.payload));
  }

  getMcpServer(id: string): McpServer | undefined {
    const row = this.db.prepare("SELECT payload FROM mcp_servers WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? parseJson<McpServer>(row.payload) : undefined;
  }

  saveMcpServer(server: McpServer): void {
    this.db.prepare("INSERT INTO mcp_servers (id, project_path, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_path=excluded.project_path, payload=excluded.payload, updated_at=excluded.updated_at")
      .run(server.id, server.projectPath, JSON.stringify(server), server.updatedAt);
  }

  deleteMcpServer(id: string): boolean {
    return this.db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id).changes > 0;
  }

  listCustomProviders(): CustomProviderConfig[] {
    const rows = this.db.prepare("SELECT id, label, base_url FROM custom_providers ORDER BY label COLLATE NOCASE").all() as Array<{ id: string; label: string; base_url: string }>;
    return rows.map((row) => ({ id: row.id, label: row.label, baseUrl: row.base_url }));
  }

  saveCustomProvider(provider: CustomProviderConfig): void {
    this.db.prepare("INSERT INTO custom_providers (id, label, base_url, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label=excluded.label, base_url=excluded.base_url, updated_at=excluded.updated_at")
      .run(provider.id, provider.label, provider.baseUrl, new Date().toISOString());
  }

  deleteCustomProvider(id: string): boolean {
    return this.db.prepare("DELETE FROM custom_providers WHERE id = ?").run(id).changes > 0;
  }

  listCodeIndexFiles(projectPath: string): CodeIndexedFile[] {
    const rows = this.db.prepare("SELECT path, hash, size, mtime_ms, symbols FROM code_index_files WHERE project_path = ?").all(projectPath) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const stored = parseJson<CodeSymbol[] | { symbols: CodeSymbol[]; relationships?: CodeRelationship[] }>(String(row.symbols));
      return {
        path: String(row.path), hash: String(row.hash), size: Number(row.size), mtimeMs: Number(row.mtime_ms),
        symbols: Array.isArray(stored) ? stored : stored.symbols,
        relationships: Array.isArray(stored) ? [] : stored.relationships ?? [],
      };
    });
  }

  upsertCodeIndexFile(projectPath: string, file: CodeIndexedFile, content: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM code_index_lines WHERE project_path = ? AND path = ?").run(projectPath, file.path);
      this.db.prepare("INSERT INTO code_index_files (project_path, path, hash, size, mtime_ms, symbols) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_path, path) DO UPDATE SET hash=excluded.hash, size=excluded.size, mtime_ms=excluded.mtime_ms, symbols=excluded.symbols")
        .run(projectPath, file.path, file.hash, file.size, file.mtimeMs, JSON.stringify({ symbols: file.symbols, relationships: file.relationships }));
      const insertLine = this.db.prepare("INSERT INTO code_index_lines (project_path, path, line, content) VALUES (?, ?, ?, ?)");
      const lines = content.split(/\r?\n/).slice(0, 20_000);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (line.trim()) insertLine.run(projectPath, file.path, index + 1, line.slice(0, 20_000));
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  deleteCodeIndexFiles(projectPath: string, paths: string[]): void {
    if (!paths.length) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const deleteLines = this.db.prepare("DELETE FROM code_index_lines WHERE project_path = ? AND path = ?");
      const deleteFile = this.db.prepare("DELETE FROM code_index_files WHERE project_path = ? AND path = ?");
      for (const path of paths) { deleteLines.run(projectPath, path); deleteFile.run(projectPath, path); }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  searchCodeText(projectPath: string, query: string, limit = 100): Array<{ path: string; line: number; excerpt: string }> {
    const terms = query.match(/[\p{L}\p{N}_$]+/gu)?.filter((term) => /[\p{L}\p{N}]/u.test(term)).slice(0, 8) ?? [];
    if (!terms.length) return [];
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ");
    const rows = this.db.prepare("SELECT path, line, content FROM code_index_lines WHERE project_path = ? AND code_index_lines MATCH ? ORDER BY bm25(code_index_lines) LIMIT ?")
      .all(projectPath, match, Math.max(1, Math.min(100, Math.trunc(limit)))) as Array<{ path: string; line: number | string; content: string }>;
    return rows.map((row) => ({ path: String(row.path), line: Number(row.line), excerpt: String(row.content).slice(0, 350) }));
  }

  createSession(input: Omit<SessionRecord, "createdAt" | "updatedAt" | "sequence">): SessionRecord {
    const now = new Date().toISOString();
    const record: SessionRecord = { ...input, createdAt: now, updatedAt: now, sequence: 0 };
    this.db.prepare("INSERT INTO sessions (id, project_path, title, model_id, provider_id, free_only, budget_json, reasoning_effort, mode, permission_profile, state, created_at, updated_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.projectPath, record.title, record.modelId ?? null, record.providerId ?? null, record.freeOnly ? 1 : 0, JSON.stringify(record.budget ?? {}), record.reasoningEffort ?? null, record.mode, record.permissionProfile, record.state, record.createdAt, record.updatedAt, record.sequence);
    return record;
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.prepare("SELECT id, project_path, title, model_id, provider_id, free_only, budget_json, reasoning_effort, mode, permission_profile, state, created_at, updated_at, sequence FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.sessionFromRow(row) : undefined;
  }

  listSessions(projectPath?: string, limit = 100): SessionRecord[] {
    const rows = projectPath
      ? this.db.prepare("SELECT id, project_path, title, model_id, provider_id, free_only, budget_json, reasoning_effort, mode, permission_profile, state, created_at, updated_at, sequence FROM sessions WHERE project_path = ? ORDER BY updated_at DESC LIMIT ?").all(projectPath, limit)
      : this.db.prepare("SELECT id, project_path, title, model_id, provider_id, free_only, budget_json, reasoning_effort, mode, permission_profile, state, created_at, updated_at, sequence FROM sessions ORDER BY updated_at DESC LIMIT ?").all(limit);
    return (rows as Array<Record<string, unknown>>).map((row) => this.sessionFromRow(row));
  }

  updateSession(id: string, patch: Partial<Pick<SessionRecord, "title" | "modelId" | "providerId" | "freeOnly" | "budget" | "reasoningEffort" | "mode" | "permissionProfile" | "state">>): SessionRecord {
    const current = this.getSession(id);
    if (!current) throw new Error(`Session not found: ${id}`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare("UPDATE sessions SET title=?, model_id=?, provider_id=?, free_only=?, budget_json=?, reasoning_effort=?, mode=?, permission_profile=?, state=?, updated_at=? WHERE id=?")
      .run(next.title, next.modelId ?? null, next.providerId ?? null, next.freeOnly ? 1 : 0, JSON.stringify(next.budget ?? {}), next.reasoningEffort ?? null, next.mode, next.permissionProfile, next.state, next.updatedAt, id);
    return next;
  }

  listMessages(sessionId: string, limit = 100): MessageRecord[] {
    const rows = this.db.prepare("SELECT id, session_id, role, content, created_at, run_id, tool_name, tool_call_id, tool_calls FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?").all(sessionId, limit) as Array<Record<string, unknown>>;
    return rows.reverse().map((row) => ({ id: String(row.id), sessionId: String(row.session_id), role: row.role as MessageRecord["role"], content: String(row.content), createdAt: String(row.created_at), ...(row.run_id ? { runId: String(row.run_id) } : {}), ...(row.tool_name ? { toolName: String(row.tool_name) } : {}), ...(row.tool_call_id ? { toolCallId: String(row.tool_call_id) } : {}), ...(row.tool_calls ? { toolCalls: parseJson<ProviderToolCall[]>(String(row.tool_calls)) } : {}) }));
  }

  appendMessage(message: MessageRecord): void {
    this.db.prepare("INSERT INTO messages (id, session_id, role, content, created_at, run_id, tool_name, tool_call_id, tool_calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(message.id, message.sessionId, message.role, message.content, message.createdAt, message.runId ?? null, message.toolName ?? null, message.toolCallId ?? null, message.toolCalls ? JSON.stringify(message.toolCalls) : null);
  }

  appendEvent(event: HarnessEvent): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO events (id, session_id, sequence, created_at, type, run_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)").run(event.id, event.sessionId, event.sequence, event.createdAt, event.type, event.runId ?? null, JSON.stringify(event.payload));
      this.db.prepare("UPDATE sessions SET sequence = ?, updated_at = ? WHERE id = ?").run(event.sequence, event.createdAt, event.sessionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listEvents(sessionId: string, afterSequence = 0, limit = 500): HarnessEvent[] {
    const rows = this.db.prepare("SELECT id, session_id, sequence, created_at, type, run_id, payload FROM events WHERE session_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?").all(sessionId, afterSequence, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ protocol: 1, id: String(row.id), sessionId: String(row.session_id), sequence: Number(row.sequence), createdAt: String(row.created_at), type: row.type as HarnessEvent["type"], ...(row.run_id ? { runId: String(row.run_id) } : {}), payload: parseJson<Record<string, unknown>>(String(row.payload)) }));
  }

  recordUsageCall(record: UsageCallRecord): void {
    const inputTokens = safeCount(record.inputTokens ?? undefined);
    const outputTokens = safeCount(record.outputTokens ?? undefined);
    const measuredCalls = record.measuredCalls ?? (inputTokens !== null && outputTokens !== null ? 1 : 0);
    this.db.prepare(`
      INSERT INTO usage_calls (
        id, session_id, project_path, run_id, provider_id, model_id, occurred_at, local_day,
        input_tokens, output_tokens, cached_tokens, estimated_sent_tokens, estimated_saved_tokens,
        provider_calls, measured_calls, source_kind, source_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, cached_tokens=excluded.cached_tokens,
        estimated_sent_tokens=excluded.estimated_sent_tokens, estimated_saved_tokens=excluded.estimated_saved_tokens,
        provider_calls=excluded.provider_calls, measured_calls=excluded.measured_calls
    `).run(
      record.id, record.sessionId, record.projectPath, record.runId, record.providerId, record.modelId,
      record.occurredAt, record.localDay,
      inputTokens, outputTokens, safeCount(record.cachedTokens), safeCount(record.estimatedSentTokens), safeCount(record.estimatedSavedTokens),
      safeCount(record.providerCalls ?? 1) ?? 1, safeCount(measuredCalls) ?? 0,
      record.sourceKind ?? "live", record.sourceEventId ?? null,
    );
  }

  getUsageAnalytics(query: UsageAnalyticsQuery): UsageAnalytics {
    const parameters: Array<string | number> = [query.projectPath];
    const clauses = ["project_path = ?"];
    if (query.days !== 0) { clauses.push("local_day >= ?"); parameters.push(dayKeyOffset(query.days - 1)); }
    if (query.sessionId) { clauses.push("session_id = ?"); parameters.push(query.sessionId); }
    if (query.modelId) { clauses.push("model_id = ?"); parameters.push(query.modelId); }
    const where = clauses.join(" AND ");
    const summary = this.db.prepare(`
      SELECT
        COALESCE(SUM(provider_calls), 0) AS provider_calls,
        COALESCE(SUM(measured_calls), 0) AS measured_calls,
        COALESCE(SUM(CASE WHEN source_kind = 'legacy' THEN provider_calls ELSE 0 END), 0) AS legacy_calls,
        COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL THEN 1 ELSE 0 END), 0) AS reported_token_records,
        COUNT(DISTINCT local_day) AS active_days, MIN(occurred_at) AS first_activity_at,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
        COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL THEN 1 ELSE 0 END), 0) AS input_token_records,
        COALESCE(SUM(CASE WHEN output_tokens IS NOT NULL THEN 1 ELSE 0 END), 0) AS output_token_records,
        COALESCE(SUM(CASE WHEN cached_tokens IS NOT NULL THEN 1 ELSE 0 END), 0) AS cached_token_records,
        COALESCE(SUM(estimated_sent_tokens), 0) AS estimated_sent_tokens,
        COALESCE(SUM(estimated_saved_tokens), 0) AS estimated_saved_tokens,
        COALESCE(SUM(CASE WHEN estimated_saved_tokens IS NOT NULL THEN provider_calls ELSE 0 END), 0) AS savings_calls,
        COALESCE(SUM(CASE WHEN estimated_saved_tokens IS NULL THEN provider_calls ELSE 0 END), 0) AS untracked_savings_calls
      FROM usage_calls WHERE ${where}
    `).get(...parameters) as Record<string, unknown>;

    const lifetimeClauses = ["project_path = ?"];
    const lifetimeParams: string[] = [query.projectPath];
    if (query.sessionId) { lifetimeClauses.push("session_id = ?"); lifetimeParams.push(query.sessionId); }
    if (query.modelId) { lifetimeClauses.push("model_id = ?"); lifetimeParams.push(query.modelId); }
    const lifetime = this.db.prepare(`SELECT MIN(occurred_at) AS first_activity_at FROM usage_calls WHERE ${lifetimeClauses.join(" AND ")}`).get(...lifetimeParams) as { first_activity_at?: string | null };

    const optionsWhere = ["u.project_path = ?"];
    const optionsParams: string[] = [query.projectPath];
    if (query.sessionId) { optionsWhere.push("u.session_id = ?"); optionsParams.push(query.sessionId); }
    const optionsFilter = optionsWhere.join(" AND ");
    const sessions = (this.db.prepare(`
      SELECT s.id, COALESCE(NULLIF(s.title, ''), s.project_path) AS title
      FROM usage_calls u JOIN sessions s ON s.id = u.session_id
      WHERE u.project_path = ?
      GROUP BY s.id, s.title, s.project_path
      ORDER BY MAX(u.occurred_at) DESC
    `).all(query.projectPath) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), title: String(row.title) }));
    const models = (this.db.prepare(`SELECT DISTINCT u.model_id FROM usage_calls u WHERE ${optionsFilter} ORDER BY u.model_id COLLATE NOCASE`).all(...optionsParams) as Array<{ model_id: string }>).map((row) => String(row.model_id));

    const chartStart = dayKeyOffset(query.days === 0 ? 89 : query.days - 1);
    const pointClauses = ["project_path = ?", "local_day >= ?"];
    const pointParams: Array<string | number> = [query.projectPath, chartStart];
    if (query.sessionId) { pointClauses.push("session_id = ?"); pointParams.push(query.sessionId); }
    if (query.modelId) { pointClauses.push("model_id = ?"); pointParams.push(query.modelId); }
    const points = this.db.prepare(`
      SELECT local_day AS day,
        COALESCE(SUM(provider_calls), 0) AS provider_calls,
        COALESCE(SUM(measured_calls), 0) AS measured_calls,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(estimated_sent_tokens), 0) AS estimated_sent_tokens,
        COALESCE(SUM(estimated_saved_tokens), 0) AS estimated_saved_tokens,
        COALESCE(SUM(CASE WHEN estimated_saved_tokens IS NOT NULL THEN provider_calls ELSE 0 END), 0) AS savings_calls
      FROM usage_calls WHERE ${pointClauses.join(" AND ")} GROUP BY local_day ORDER BY local_day ASC
    `).all(...pointParams) as Array<Record<string, unknown>>;

    return {
      providerCalls: finiteNumber(summary.provider_calls), measuredCalls: finiteNumber(summary.measured_calls), legacyCalls: finiteNumber(summary.legacy_calls),
      reportedTokenRecords: finiteNumber(summary.reported_token_records), activeDays: finiteNumber(summary.active_days),
      firstActivityAt: typeof lifetime.first_activity_at === "string" ? lifetime.first_activity_at : null,
      inputTokens: finiteNumber(summary.input_tokens), outputTokens: finiteNumber(summary.output_tokens), cachedTokens: finiteNumber(summary.cached_tokens),
      inputTokenRecords: finiteNumber(summary.input_token_records), outputTokenRecords: finiteNumber(summary.output_token_records), cachedTokenRecords: finiteNumber(summary.cached_token_records),
      estimatedSentTokens: finiteNumber(summary.estimated_sent_tokens), estimatedSavedTokens: finiteNumber(summary.estimated_saved_tokens),
      savingsCalls: finiteNumber(summary.savings_calls), untrackedSavingsCalls: finiteNumber(summary.untracked_savings_calls),
      sessions, models,
      points: points.map((row) => ({
        day: String(row.day), providerCalls: finiteNumber(row.provider_calls), measuredCalls: finiteNumber(row.measured_calls),
        inputTokens: finiteNumber(row.input_tokens), outputTokens: finiteNumber(row.output_tokens),
        estimatedSentTokens: finiteNumber(row.estimated_sent_tokens), estimatedSavedTokens: finiteNumber(row.estimated_saved_tokens),
        savingsCalls: finiteNumber(row.savings_calls),
      })),
    };
  }

  private backfillCompletedRunUsage(): void {
    const rows = this.db.prepare(`
      SELECT e.id, e.session_id, e.run_id, e.created_at, e.payload, s.project_path
      FROM events e JOIN sessions s ON s.id = e.session_id
      WHERE e.type = 'run.completed' AND NOT EXISTS (SELECT 1 FROM usage_calls u WHERE u.source_event_id = e.id)
    `).all() as Array<Record<string, unknown>>;
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO usage_calls (
        id, session_id, project_path, run_id, provider_id, model_id, occurred_at, local_day,
        input_tokens, output_tokens, cached_tokens, estimated_sent_tokens, estimated_saved_tokens,
        provider_calls, measured_calls, source_kind, source_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, 'legacy', ?)
    `);
    for (const row of rows) {
      try {
        const payload = parseJson<Record<string, unknown>>(String(row.payload));
        const result = payload.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : {};
        const usage = result.usage && typeof result.usage === "object" ? result.usage as Record<string, unknown> : {};
        const runSession = result.session && typeof result.session === "object" ? result.session as Record<string, unknown> : {};
        const providerCalls = Math.trunc(finiteNumber(usage.providerCalls));
        if (providerCalls < 1) continue;
        const numberOrNull = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
        const occurredAt = String(row.created_at);
        insert.run(
          `legacy_${String(row.id)}`, String(row.session_id), String(row.project_path), String(row.run_id ?? ""),
          typeof runSession.providerId === "string" ? runSession.providerId : "unknown",
          typeof runSession.modelId === "string" ? runSession.modelId : "unknown",
          occurredAt, localDayKey(occurredAt), numberOrNull(usage.inputTokens), numberOrNull(usage.outputTokens), numberOrNull(usage.cachedTokens),
          providerCalls, String(row.id),
        );
      } catch {
        // A damaged old event must not prevent the local Harness from opening.
      }
    }
  }

  addPermissionRule(rule: PermissionRule): void {
    this.db.prepare("INSERT OR REPLACE INTO permission_rules (id, payload, project_path) VALUES (?, ?, ?)").run(rule.id, JSON.stringify(rule), rule.projectPath ?? null);
  }

  listPermissionRules(projectPath?: string): PermissionRule[] {
    const rows = projectPath
      ? this.db.prepare("SELECT payload FROM permission_rules WHERE project_path IS NULL OR project_path = ?").all(projectPath)
      : this.db.prepare("SELECT payload FROM permission_rules").all();
    return (rows as Array<{ payload: string }>).map((row) => parseJson<PermissionRule>(row.payload));
  }

  addPermissionRequest(request: PermissionRequest): void {
    this.db.prepare("INSERT OR REPLACE INTO permission_requests (id, session_id, payload, decision) VALUES (?, ?, ?, NULL)").run(request.id, request.sessionId, JSON.stringify(request));
  }

  resolvePermissionRequest(id: string, decision: string): void {
    this.db.prepare("UPDATE permission_requests SET decision=? WHERE id=?").run(decision, id);
  }

  listPendingPermissionRequests(): PermissionRequest[] {
    const rows = this.db.prepare("SELECT payload FROM permission_requests WHERE decision IS NULL ORDER BY rowid").all() as Array<{ payload: string }>;
    return rows.map((row) => parseJson<PermissionRequest>(row.payload));
  }

  listEnabledSkills(projectPath: string): string[] {
    return (this.db.prepare("SELECT skill_path FROM active_project_skills WHERE project_path = ? ORDER BY skill_path").all(projectPath) as Array<{ skill_path: string }>).map((row) => row.skill_path);
  }

  setEnabledSkills(projectPath: string, skillPaths: string[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM active_project_skills WHERE project_path = ?").run(projectPath);
      const insert = this.db.prepare("INSERT INTO active_project_skills (project_path, skill_path) VALUES (?, ?)");
      for (const skillPath of [...new Set(skillPaths)]) insert.run(projectPath, skillPath);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveCheckpoint(sessionId: string, checkpoint: unknown): void {
    this.db.prepare("INSERT INTO runtime_checkpoints (session_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").run(sessionId, JSON.stringify(checkpoint), new Date().toISOString());
  }

  getCheckpoint(sessionId: string): unknown | undefined {
    const row = this.db.prepare("SELECT payload FROM runtime_checkpoints WHERE session_id=?").get(sessionId) as { payload: string } | undefined;
    return row ? parseJson<unknown>(row.payload) : undefined;
  }

  deleteCheckpoint(sessionId: string): void { this.db.prepare("DELETE FROM runtime_checkpoints WHERE session_id=?").run(sessionId); }

  close(): void { this.db.close(); }

  private sessionFromRow(row: Record<string, unknown>): SessionRecord {
    return {
      id: String(row.id), projectPath: String(row.project_path), title: String(row.title),
      ...(row.model_id ? { modelId: String(row.model_id) } : {}), ...(row.provider_id ? { providerId: String(row.provider_id) } : {}),
      freeOnly: Number(row.free_only) === 1,
      ...(typeof row.reasoning_effort === "string" ? { reasoningEffort: row.reasoning_effort } : {}),
      budget: { maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxDurationMs: null, maxToolCalls: null, ...parseJson<Partial<NonNullable<SessionRecord["budget"]>>>(String(row.budget_json ?? "{}")) },
      mode: row.mode as SessionRecord["mode"], permissionProfile: row.permission_profile as SessionRecord["permissionProfile"], state: row.state as SessionRecord["state"],
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), sequence: Number(row.sequence),
    };
  }
}

export function newId(prefix: string): string { return `${prefix}_${randomUUID()}`; }
