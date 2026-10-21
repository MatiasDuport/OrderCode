import { createHash, randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { delimiter, dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { HarnessError } from "./errors.js";
import type { Persistence } from "./persistence.js";
import type { McpServer, McpServerDraft, McpServerStatus, McpToolSummary, ToolEffect, ToolDefinition } from "./types.js";
import { ToolRegistry } from "./tools.js";

interface ActiveConnection {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  server: McpServer;
  tools: McpToolSummary[];
  names: string[];
  error?: string;
}

const MAX_SERVERS = 32;
const MAX_TOOLS = 128;
const CONNECT_TIMEOUT_MS = 15_000;
const SECRET_KEY = /^[A-Z_][A-Z0-9_]{0,63}$/;

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function safeSchema(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 8) return { type: "object", properties: {} };
  const source = value as Record<string, unknown>;
  if (source.type !== "object") return { type: "object", properties: {} };
  const output: Record<string, unknown> = { type: "object", additionalProperties: false };
  const properties = source.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const result: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(properties as Record<string, unknown>).slice(0, 128)) {
      if (!validText(key, 128) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const property = raw as Record<string, unknown>;
      const type = ["string", "number", "integer", "boolean", "array", "object", "null"].includes(String(property.type)) ? String(property.type) : "string";
      const next: Record<string, unknown> = { type };
      if (validText(property.description, 1000)) next.description = property.description;
      if (Array.isArray(property.enum) && property.enum.length <= 100 && property.enum.every((item) => ["string", "number", "boolean"].includes(typeof item))) next.enum = property.enum;
      if ((type === "object" || type === "array") && property.properties) next.properties = safeSchema({ type: "object", properties: property.properties }, depth + 1).properties;
      if (type === "array" && property.items && typeof property.items === "object" && !Array.isArray(property.items)) {
        const item = property.items as Record<string, unknown>;
        next.items = { type: ["string", "number", "integer", "boolean", "object"].includes(String(item.type)) ? item.type : "string" };
      }
      if (typeof property.minimum === "number" && Number.isFinite(property.minimum)) next.minimum = property.minimum;
      if (typeof property.maximum === "number" && Number.isFinite(property.maximum)) next.maximum = property.maximum;
      result[key] = next;
    }
    output.properties = result;
  }
  if (Array.isArray(source.required)) output.required = source.required.filter((name): name is string => typeof name === "string" && !!(output.properties as Record<string, unknown> | undefined)?.[name]).slice(0, 128);
  return output;
}

function exposedToolName(serverId: string, remoteName: string): string {
  const digest = createHash("sha256").update(remoteName).digest("hex").slice(0, 12);
  return `mcp_${serverId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-24)}_${digest}`;
}

function summarizeToolResult(result: unknown, secrets: string[]): { isError: boolean; content: string; structuredContent?: unknown } {
  const object = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const blocks = Array.isArray(object.content) ? object.content : [];
  const text = blocks.map((block) => block && typeof block === "object" && (block as Record<string, unknown>).type === "text" ? String((block as Record<string, unknown>).text ?? "") : `[${String((block as Record<string, unknown>)?.type ?? "unknown")} content omitted]`).join("\n").slice(0, 24_000);
  const structuredContent = object.structuredContent;
  let serialized = text || (structuredContent === undefined ? "The MCP server returned no textual content." : JSON.stringify(structuredContent).slice(0, 24_000));
  for (const secret of secrets) if (secret.length > 2) serialized = serialized.replaceAll(secret, "[credential redacted]");
  const safeStructured = structuredContent === undefined ? undefined : JSON.parse(JSON.stringify(structuredContent, (_key, value) => typeof value === "string" ? secrets.reduce((out, secret) => secret.length > 2 ? out.replaceAll(secret, "[credential redacted]") : out, value) : value));
  return { isError: object.isError === true, content: serialized, ...(safeStructured === undefined ? {} : { structuredContent: safeStructured }) };
}

function safeChildEnvironment(secrets: Record<string, string>): Record<string, string> {
  const allowed = process.platform === "win32"
    ? ["PATH", "Path", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
    : ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"];
  const environment: Record<string, string> = {};
  for (const key of allowed) if (process.env[key]) environment[key] = process.env[key]!;
  const inheritedPath = environment.PATH ?? environment.Path ?? "";
  delete environment.Path;
  environment.PATH = `${dirname(process.execPath)}${delimiter}${inheritedPath}`;
  for (const [key, value] of Object.entries(secrets)) if (SECRET_KEY.test(key)) environment[key] = value;
  return environment;
}

export function resolveMcpExecutable(command: string, args: string[]): { command: string; args: string[] } {
  if (!/^npx(?:\.cmd|\.exe)?$/i.test(command)) return { command, args: [...args] };
  const cli = fileURLToPath(new URL("./npm/bin/npx-cli.js", import.meta.url));
  if (!existsSync(cli)) throw new HarnessError("MCP_NPM_UNAVAILABLE", "El instalador npm interno no está disponible. Reinstala o vuelve a compilar OrderCode.");
  return { command: process.execPath, args: [cli, ...args] };
}

export function resolveMcpLaunch(server: Pick<McpServer, "command" | "args" | "projectPath">, credentials: Record<string, string> = {}): { command: string; args: string[]; cwd: string; env: Record<string, string> } {
  const executable = resolveMcpExecutable(server.command!, server.args);
  const environment = safeChildEnvironment(credentials);
  let workingDirectory = server.projectPath;
  if (executable.command === process.execPath && executable.args[0]?.endsWith("npx-cli.js")) {
    environment.NPM_CONFIG_REGISTRY = "https://registry.npmjs.org";
    environment.NPM_CONFIG_CACHE = join(homedir(), ".ordercode", "npm-cache");
    environment.NPM_CONFIG_LOGLEVEL = "error";
    environment.NPM_CONFIG_UPDATE_NOTIFIER = "false";
    environment.NPM_CONFIG_AUDIT = "false";
    environment.NPM_CONFIG_FUND = "false";
    environment.NPM_CONFIG_LOGS_MAX = "0";
    if (server.args.includes("@playwright/mcp@0.0.83")) {
      // Distinct absent config files bypass personal credentials. npm rejects loading
      // the same path twice, including NUL or /dev/null, for user and global config.
      const npmRoot = resolve(dirname(executable.args[0]!), "..");
      environment.NPM_CONFIG_USERCONFIG = join(npmRoot, "ordercode-disabled-user.npmrc");
      environment.NPM_CONFIG_GLOBALCONFIG = join(npmRoot, "ordercode-disabled-global.npmrc");
      environment.NPM_CONFIG_IGNORE_SCRIPTS = "true";
      workingDirectory = npmRoot;
      // Browser artifacts belong to the workspace, never to the packaged npm directory.
      if (!server.args.some((argument) => argument === "--output-dir" || argument.startsWith("--output-dir="))) executable.args.push("--output-dir", join(server.projectPath, ".playwright-mcp"));
    }
  }
  return { ...executable, cwd: workingDirectory, env: environment };
}

export class McpRegistry {
  private readonly active = new Map<string, ActiveConnection>();
  private readonly credentials = new Map<string, Record<string, string>>();
  private readonly errors = new Map<string, string>();

  constructor(private readonly persistence: Persistence, private readonly tools: ToolRegistry) {}

  list(projectPath?: string): McpServerStatus[] {
    const servers = this.persistence.listMcpServers(projectPath ? resolve(projectPath) : undefined);
    return servers.map((server) => {
      const connection = this.active.get(server.id);
      return { server, connected: !!connection, toolCount: connection?.tools.length ?? 0, tools: connection?.tools ?? [], ...(connection?.error || this.errors.get(server.id) ? { error: connection?.error ?? this.errors.get(server.id) } : {}) };
    });
  }

  get(id: string): McpServer | undefined { return this.persistence.getMcpServer(id); }

  async save(draft: McpServerDraft, authorize?: () => void): Promise<McpServer> {
    if (!draft || typeof draft !== "object") throw new HarnessError("INVALID_MCP_SERVER", "MCP server configuration is required.");
    if (!validText(draft.projectPath, 4096)) throw new HarnessError("INVALID_MCP_SERVER", "Choose a workspace for this MCP server.");
    const projectPath = resolve(draft.projectPath);
    const name = typeof draft.name === "string" ? draft.name.trim() : "";
    if (!validText(name, 80)) throw new HarnessError("INVALID_MCP_SERVER", "Server name must contain 1–80 printable characters.");
    if (draft.transport !== "stdio" && draft.transport !== "streamable-http") throw new HarnessError("INVALID_MCP_SERVER", "Unsupported MCP transport.");
    if (typeof draft.enabled !== "boolean") throw new HarnessError("INVALID_MCP_SERVER", "MCP server enabled state must be explicit.");
    const args = Array.isArray(draft.args) ? draft.args : [];
    if (args.length > 64 || args.some((arg) => typeof arg !== "string" || arg.length > 2000 || arg.includes("\0"))) throw new HarnessError("INVALID_MCP_SERVER", "MCP command arguments must contain at most 64 valid entries.");
    const secretKeys = Array.isArray(draft.secretKeys) ? [...new Set(draft.secretKeys)] : [];
    if (secretKeys.length > 32 || secretKeys.some((key) => typeof key !== "string" || !SECRET_KEY.test(key))) throw new HarnessError("INVALID_MCP_SERVER", "MCP credential names must be valid environment variable names.");
    const existing = draft.id ? this.persistence.getMcpServer(draft.id) : undefined;
    if (draft.id && (!existing || existing.projectPath !== projectPath)) throw new HarnessError("INVALID_MCP_SERVER", "Only an MCP server in this workspace can be edited.");
    if (!existing && this.persistence.listMcpServers(projectPath).length >= MAX_SERVERS) throw new HarnessError("INVALID_MCP_SERVER", `A workspace can have at most ${MAX_SERVERS} MCP servers.`);
    const server: McpServer = {
      id: existing?.id ?? `mcp_${randomUUID().replaceAll("-", "")}`,
      projectPath,
      name,
      transport: draft.transport,
      args: [...args],
      secretKeys,
      enabled: draft.enabled,
      ...(draft.marketplace ? { marketplace: validateMarketplaceOrigin(draft.marketplace) } : existing?.marketplace ? { marketplace: existing.marketplace } : {}),
      ...(draft.transport === "stdio" ? { command: validateCommand(draft.command) } : { endpoint: validateEndpoint(draft.endpoint) }),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.disconnect(server.id);
    authorize?.();
    this.persistence.saveMcpServer(server);
    this.errors.delete(server.id);
    return server;
  }

  configureCredentials(serverId: string, values: unknown): boolean {
    const server = this.persistence.getMcpServer(serverId);
    if (!server || !values || typeof values !== "object" || Array.isArray(values)) throw new HarnessError("INVALID_MCP_CREDENTIAL", "MCP server and credential values are required.");
    const source = values as Record<string, unknown>;
    const previous = this.credentials.get(server.id) ?? {};
    const credentials: Record<string, string> = {};
    for (const key of server.secretKeys) {
      const value = source[key];
      if (typeof value === "string" && value.length <= 4096 && !value.includes("\0")) credentials[key] = value;
      else if (previous[key]) credentials[key] = previous[key]!;
    }
    this.credentials.set(server.id, credentials);
    return true;
  }

  async connect(id: string, authorize?: () => void): Promise<McpServerStatus> {
    const server = this.persistence.getMcpServer(id);
    if (!server) throw new HarnessError("MCP_SERVER_NOT_FOUND", "MCP server not found.");
    if (!server.enabled) throw new HarnessError("MCP_SERVER_DISABLED", "Enable this MCP server before connecting.");
    await this.disconnect(id);
    const credentials = this.credentials.get(id) ?? {};
    const client = new Client({ name: "ordercode", version: "0.1.0" });
    let transport: StdioClientTransport | StreamableHTTPClientTransport;
    let startupDiagnostic = "";
    if (server.transport === "stdio") {
      const curatedBrowser = server.args.includes("@playwright/mcp@0.0.83") && /^npx(?:\.cmd|\.exe)?$/i.test(server.command!);
      transport = new StdioClientTransport({ ...resolveMcpLaunch(server, credentials), stderr: curatedBrowser ? "pipe" : "ignore", maxBufferSize: 5_000_000 });
      if (curatedBrowser) transport.stderr?.on("data", (chunk: Buffer | string) => { startupDiagnostic = `${startupDiagnostic}${String(chunk)}`.slice(-4000); });
    } else {
      const authorization = credentials.__AUTHORIZATION__;
      transport = new StreamableHTTPClientTransport(new URL(server.endpoint!), { requestInit: { headers: authorization ? { Authorization: `Bearer ${authorization}` } : {} }, onInsufficientScope: "throw", redirectPolicy: "same-origin" });
    }
    const timeout = server.transport === "stdio" && /^npx(?:\.cmd|\.exe)?$/i.test(server.command!) ? 120_000 : CONNECT_TIMEOUT_MS;
    const timer = setTimeout(() => client.close().catch(() => undefined), timeout);
    try {
      authorize?.();
      await client.connect(transport, { timeout });
      const response = await client.listTools();
      if (response.tools.length > MAX_TOOLS) throw new HarnessError("MCP_TOOL_LIMIT", `This MCP server exposes more than ${MAX_TOOLS} tools.`);
      const tools: McpToolSummary[] = response.tools.map((tool) => ({ name: tool.name.slice(0, 128), description: String(tool.description ?? "External MCP tool.").slice(0, 1000), inputSchema: safeSchema(tool.inputSchema), readOnly: tool.annotations?.readOnlyHint === true }));
      const names: string[] = [];
      response.tools.forEach((remoteTool, index) => {
        const summary = tools[index]!;
        const localName = exposedToolName(server.id, remoteTool.name);
        const permissionEffect: ToolEffect = summary.readOnly ? (server.transport === "stdio" ? "EXECUTE" : "NETWORK") : "DESTRUCTIVE";
        const definition: ToolDefinition = { name: localName, description: `Untrusted MCP server “${server.name}”, tool “${summary.name}”: ${summary.description}`, effects: summary.readOnly ? [permissionEffect] : [permissionEffect, "DESTRUCTIVE"], cancellable: true, inputSchema: summary.inputSchema };
        this.tools.registerMcpTool({ definition, projectPath: server.projectPath, permissionEffect, invoke: async (args, signal) => {
          if (signal?.aborted) throw new HarnessError("MCP_TOOL_CANCELLED", "MCP tool invocation cancelled before request.");
          const result = await client.callTool({ name: remoteTool.name, arguments: args }, { ...(signal ? { signal } : {}), timeout: 120_000, resetTimeoutOnProgress: true });
          return summarizeToolResult(result, Object.values(credentials));
        } });
        names.push(localName);
      });
      const active: ActiveConnection = { client, transport, server, tools, names };
      this.active.set(id, active);
      this.errors.delete(id);
      transport.onclose = () => { if (this.active.get(id) === active) { this.active.delete(id); this.tools.unregisterMcpTools(server.id); } };
      transport.onerror = (error) => { active.error = sanitizeError(error, Object.values(credentials)); this.errors.set(id, active.error); };
      return this.list(server.projectPath).find((item) => item.server.id === id)!;
    } catch (error) {
      this.tools.unregisterMcpTools(server.id);
      const message = sanitizeError(startupDiagnostic.trim() ? `${error instanceof Error ? error.message : String(error)}: ${startupDiagnostic.trim()}` : error, Object.values(credentials));
      this.errors.set(id, message);
      await client.close().catch(() => undefined);
      throw new HarnessError("MCP_CONNECTION_FAILED", message, { serverId: id });
    } finally { clearTimeout(timer); }
  }

  async disconnect(id: string): Promise<boolean> {
    const active = this.active.get(id);
    this.active.delete(id);
    this.tools.unregisterMcpTools(this.persistence.getMcpServer(id)?.id ?? id);
    if (!active) return false;
    await active.client.close().catch(() => undefined);
    return true;
  }

  async delete(id: string): Promise<boolean> {
    await this.disconnect(id);
    this.credentials.delete(id);
    this.errors.delete(id);
    return this.persistence.deleteMcpServer(id);
  }

  async close(): Promise<void> { await Promise.all([...this.active.keys()].map((id) => this.disconnect(id))); }
}

function validateCommand(value: unknown): string {
  if (!validText(value, 512)) throw new HarnessError("INVALID_MCP_SERVER", "A local MCP server executable is required.");
  return value.trim();
}

function validateEndpoint(value: unknown): string {
  if (!validText(value, 2048)) throw new HarnessError("INVALID_MCP_SERVER", "A remote MCP endpoint URL is required.");
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { throw new HarnessError("INVALID_MCP_SERVER", "MCP endpoint must be a valid URL."); }
  if (endpoint.username || endpoint.password || endpoint.hash || !["https:", "http:"].includes(endpoint.protocol)) throw new HarnessError("INVALID_MCP_SERVER", "MCP endpoint must not embed credentials or fragments and must use HTTP or HTTPS.");
  const local = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && local)) throw new HarnessError("INVALID_MCP_SERVER", "Remote MCP endpoints must use HTTPS; plain HTTP is allowed only for loopback hosts.");
  return endpoint.toString();
}

function validateMarketplaceOrigin(value: McpServerDraft["marketplace"]): NonNullable<McpServer["marketplace"]> {
  if (!value || value.registryType !== "npm" || !validText(value.serverName, 200) || !validText(value.publisher, 120) || !validText(value.version, 100) || !validText(value.packageIdentifier, 214) || !validText(value.packageVersion, 100)) {
    throw new HarnessError("INVALID_MCP_MARKETPLACE_SOURCE", "Marketplace source metadata is invalid.");
  }
  let repository: URL;
  try { repository = new URL(value.repository); } catch { throw new HarnessError("INVALID_MCP_MARKETPLACE_SOURCE", "Marketplace repository URL is invalid."); }
  if (repository.protocol !== "https:" || repository.username || repository.password || !["github.com", "gitlab.com", "codeberg.org"].includes(repository.hostname.toLowerCase())) throw new HarnessError("INVALID_MCP_MARKETPLACE_SOURCE", "Marketplace repository must use a supported HTTPS code host.");
  if (!/^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(value.packageIdentifier) || /[\s*^~<>]/.test(value.packageVersion) || value.packageVersion === "latest" || value.packageVersion.length > 255) throw new HarnessError("INVALID_MCP_MARKETPLACE_SOURCE", "Marketplace package must be pinned to an exact npm package version.");
  return { ...value, repository: repository.toString() };
}

function sanitizeError(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret.length > 2) message = message.replaceAll(secret, "[credential redacted]");
  return message.slice(0, 1000);
}
