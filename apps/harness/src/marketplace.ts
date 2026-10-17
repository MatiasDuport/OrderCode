import { HarnessError } from "./errors.js";
import type { Persistence } from "./persistence.js";
import type { McpCatalogEntry, McpMarketplaceOrigin, McpServer } from "./types.js";
import { McpRegistry } from "./mcp.js";

const REGISTRY_ORIGIN = "https://registry.modelcontextprotocol.io";
const NPM_REGISTRY = "https://registry.npmjs.org";
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_ENTRIES = 30;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value.trim() : undefined;
}

interface ParsedEntry extends McpCatalogEntry { origin: McpMarketplaceOrigin }

function literalArguments(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const output: string[] = [];
  for (const item of value) {
    const argument = record(item);
    const literal = text(argument?.value, 2000);
    if (!argument || !literal || /\{[^}]+\}/.test(literal)) return undefined;
    if (argument.type === "positional") output.push(literal);
    else if (argument.type === "named" && text(argument.name, 128)) output.push(`${String(argument.name)}=${literal}`);
    else return undefined;
  }
  return output;
}

function parseServerResponse(value: unknown): ParsedEntry[] {
  const outer = record(value);
  const raw = record(outer?.server);
  if (!raw) return [];
  const meta = record(outer?._meta);
  const officialMeta = record(meta?.["io.modelcontextprotocol.registry/official"]);
  if (officialMeta?.status === "deleted") return [];
  const serverName = text(raw.name, 200);
  const description = text(raw.description, 1200) ?? "Sin descripción publicada.";
  const version = text(raw.version, 100);
  const repository = record(raw.repository);
  const repositoryUrl = text(repository?.url, 1000);
  if (!serverName || !version || !repositoryUrl) return [];
  let repo: URL;
  try { repo = new URL(repositoryUrl); } catch { return []; }
  if (repo.protocol !== "https:" || !["github.com", "gitlab.com", "codeberg.org"].includes(repo.hostname.toLowerCase())) return [];
  const packages = Array.isArray(raw.packages) ? raw.packages.slice(0, 20) : [];
  const result: ParsedEntry[] = [];
  for (const packageValue of packages) {
    const item = record(packageValue);
    if (!item || item.registryType !== "npm" || item.transport && record(item.transport)?.type !== "stdio") continue;
    const identifier = text(item.identifier, 214);
    const packageVersion = text(item.version, 255);
    if (!identifier || !packageVersion || packageVersion === "latest" || /[\s*^~<>]/.test(packageVersion) || !/^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(identifier)) continue;
    const baseUrl = text(item.registryBaseUrl, 300) ?? NPM_REGISTRY;
    if (baseUrl !== NPM_REGISTRY) continue;
    const runtime = text(item.runtimeHint, 32);
    if (runtime !== "npx") continue;
    const runtimeArguments = literalArguments(item.runtimeArguments);
    const packageArguments = literalArguments(item.packageArguments);
    if (!runtimeArguments || !packageArguments) continue;
    const commandArguments = [...runtimeArguments, `${identifier}@${packageVersion}`, ...packageArguments];
    const environmentVariables = Array.isArray(item.environmentVariables) ? item.environmentVariables.slice(0, 32) : [];
    const secretKeys = [...new Set(environmentVariables.flatMap((env) => {
      const variable = record(env);
      const name = text(variable?.name, 64);
      return name && /^[A-Z_][A-Z0-9_]{0,63}$/.test(name) ? [name] : [];
    }))];
    const publisher = serverName.split("/")[0] ?? "Publicador desconocido";
    const origin: McpMarketplaceOrigin = { serverName, publisher, version, repository: repo.toString(), registryType: "npm", packageIdentifier: identifier, packageVersion };
    result.push({ serverName, name: serverName.split("/").at(-1) ?? serverName, description, publisher, version, repository: repo.toString(), packageIdentifier: identifier, packageVersion, command: "npx", args: ["--yes", ...commandArguments], secretKeys, origin, updateAvailable: false });
  }
  return result;
}

export class McpMarketplace {
  constructor(private readonly persistence: Persistence, private readonly mcp: McpRegistry) {}

  async search(projectPath: string, query: string): Promise<McpCatalogEntry[]> {
    const trimmed = query.trim();
    if (trimmed.length > 120 || /[\u0000-\u001f]/.test(trimmed)) throw new HarnessError("INVALID_MARKETPLACE_QUERY", "Search query must be at most 120 printable characters.");
    const url = new URL("/v0.1/servers", REGISTRY_ORIGIN);
    url.searchParams.set("limit", String(MAX_ENTRIES));
    url.searchParams.set("version", "latest");
    if (trimmed) url.searchParams.set("search", trimmed);
    const response = await this.fetchJson(url);
    const results = record(response);
    const servers = Array.isArray(results?.servers) ? results.servers : [];
    const installed = this.persistence.listMcpServers(projectPath).filter((server) => !!server.marketplace);
    const newestByName = new Map<string, ParsedEntry>();
    for (const server of servers.slice(0, MAX_ENTRIES)) {
      for (const entry of parseServerResponse(server)) {
        if (!newestByName.has(entry.serverName)) newestByName.set(entry.serverName, entry);
      }
    }
    return [...newestByName.values()].map((entry) => {
      const current = installed.find((server) => server.marketplace?.serverName === entry.serverName);
      return { serverName: entry.serverName, name: entry.name, description: entry.description, publisher: entry.publisher, version: entry.version, repository: entry.repository, packageIdentifier: entry.packageIdentifier, packageVersion: entry.packageVersion, command: entry.command, args: entry.args, secretKeys: entry.secretKeys, ...(current?.marketplace ? { installedVersion: current.marketplace.packageVersion } : {}), updateAvailable: !!current?.marketplace && current.marketplace.packageVersion !== entry.packageVersion };
    });
  }

  async install(projectPath: string, serverName: string, packageVersion: string): Promise<McpServer> {
    if (!text(serverName, 200) || !text(packageVersion, 255)) throw new HarnessError("INVALID_MARKETPLACE_ENTRY", "Select a valid MCP Marketplace entry and version.");
    const serverUrl = new URL(`/v0.1/servers/${encodeURIComponent(serverName)}/versions/${encodeURIComponent(packageVersion)}`, REGISTRY_ORIGIN);
    const entry = parseServerResponse(await this.fetchJson(serverUrl)).find((candidate) => candidate.packageVersion === packageVersion);
    if (!entry) throw new HarnessError("MARKETPLACE_SERVER_UNAVAILABLE", "The selected package is not currently available as a verified, pinned npm MCP server.");
    const current = this.persistence.listMcpServers(projectPath).find((server) => server.marketplace?.serverName === entry.serverName);
    if (current?.marketplace?.packageVersion === entry.packageVersion) return current;
    if (current) await this.mcp.disconnect(current.id);
    return this.mcp.save({
      ...(current ? { id: current.id } : {}), projectPath, name: entry.name, transport: "stdio", command: entry.command,
      args: entry.args, secretKeys: entry.secretKeys, enabled: true, marketplace: entry.origin,
    });
  }

  private async fetchJson(url: URL): Promise<unknown> {
    if (url.origin !== REGISTRY_ORIGIN) throw new HarnessError("MARKETPLACE_SOURCE_BLOCKED", "Marketplace requests are restricted to the authorized MCP Registry.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "OrderCode/0.1.0" }, redirect: "error", signal: controller.signal });
      if (!response.ok) throw new HarnessError("MARKETPLACE_UNAVAILABLE", `MCP Registry returned HTTP ${response.status}.`);
      const body = await response.arrayBuffer();
      if (body.byteLength > MAX_RESPONSE_BYTES) throw new HarnessError("MARKETPLACE_RESPONSE_TOO_LARGE", "MCP Registry response exceeded the safe size limit.");
      try { return JSON.parse(Buffer.from(body).toString("utf8")) as unknown; }
      catch { throw new HarnessError("MARKETPLACE_INVALID_RESPONSE", "MCP Registry returned invalid JSON."); }
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError("MARKETPLACE_UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "MCP Registry request failed.");
    } finally { clearTimeout(timer); }
  }
}
