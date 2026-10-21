import { createInterface } from "node:readline";
import type { Interface } from "node:readline";
import { harnessRpcRequestSchema, type HarnessRpcRequest } from "@ordercode/shared";
import { errorPayload } from "./errors.js";
import { HarnessRuntime } from "./orchestrator.js";
import type { CreateSessionInput, RunInput } from "./orchestrator.js";
import type { AgentProfileDraft, UsageAnalyticsQuery } from "./types.js";

type JsonRpcRequest = HarnessRpcRequest;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function parseRequest(value: unknown): JsonRpcRequest {
  const parsed = harnessRpcRequestSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid JSON-RPC request: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

export class JsonRpcServer {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly runtime: HarnessRuntime) {}

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    if (request.id === undefined) return undefined;
    const id = request.id ?? null;
    try {
      const result = await this.dispatch(request.method, request.params);
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      const payload = errorPayload(error);
      return { jsonrpc: "2.0", id, error: { code: -32000, message: payload.message, data: payload } };
    }
  }

  attach(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Interface {
    const readline = createInterface({ input, crlfDelay: Infinity });
    const write = (response: JsonRpcResponse) => { output.write(`${JSON.stringify(response)}\n`); };
    readline.on("line", (line) => {
      let parsed: JsonRpcRequest;
      try { parsed = parseRequest(JSON.parse(line) as unknown); }
      catch (error) { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : "Invalid JSON-RPC request." } }); return; }
      void this.handle(parsed).then((response) => { if (response) write(response); }).catch((error) => {
        write({ jsonrpc: "2.0", id: parsed.id ?? null, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
      });
    });
    return readline;
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    const object = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
    switch (method) {
      case "health": return { ok: true, protocol: 1, pid: process.pid, node: process.version };
      case "session.create": return this.runtime.createSession(object as unknown as CreateSessionInput);
      case "session.get": return this.runtime.getSession(String(object.sessionId));
      case "session.update": return this.runtime.updateSession(String(object.sessionId), object.patch as Parameters<HarnessRuntime["updateSession"]>[1]);
      case "session.list": return this.runtime.listSessions(typeof object.projectPath === "string" ? object.projectPath : undefined);
      case "session.messages": return this.runtime.listMessages(String(object.sessionId), Number(object.limit ?? 200));
      case "session.context.compact": {
        if (typeof object.sessionId !== "string" || !object.sessionId) throw new Error("A session id is required to compact its context.");
        return this.runtime.compactSessionContext(object.sessionId);
      }
      case "session.events": return this.runtime.listEvents(String(object.sessionId), Number(object.afterSequence ?? 0));
      case "usage.analytics": {
        if (typeof object.projectPath !== "string" || ![0, 7, 30, 90].includes(Number(object.days))) throw new Error("A workspace path and a 7, 30, 90, or all-time range are required.");
        if (object.sessionId !== undefined && typeof object.sessionId !== "string") throw new Error("The session filter must be a session id.");
        if (object.modelId !== undefined && typeof object.modelId !== "string") throw new Error("The model filter must be a model id.");
        return this.runtime.getUsageAnalytics({
          projectPath: object.projectPath,
          days: Number(object.days) as UsageAnalyticsQuery["days"],
          ...(typeof object.sessionId === "string" && object.sessionId ? { sessionId: object.sessionId } : {}),
          ...(typeof object.modelId === "string" && object.modelId ? { modelId: object.modelId } : {}),
        });
      }
      case "session.cancel": return this.runtime.cancel(String(object.sessionId));
      case "run": {
        const run = object as unknown as RunInput;
        if (typeof run.sessionId !== "string" || typeof run.goal !== "string" || !run.goal.trim()) throw new Error("A session and non-empty goal are required.");
        if (run.continueUntilDone !== undefined && typeof run.continueUntilDone !== "boolean") throw new Error("Continuous completion must be a boolean.");
        const controller = new AbortController();
        this.controllers.set(run.sessionId, controller);
        try { return await this.runtime.run({ ...run, signal: controller.signal }); }
        finally { if (this.controllers.get(run.sessionId) === controller) this.controllers.delete(run.sessionId); }
      }
      case "permission.resolve": {
        if (typeof object.requestId !== "string" || !["reject", "once", "session", "project"].includes(String(object.decision))) throw new Error("A valid permission request id and decision are required.");
        return this.runtime.resolvePermission(object.requestId, object.decision as Parameters<HarnessRuntime["resolvePermission"]>[1]);
      }
      case "permission.pending": return this.runtime.permissions.getPending(typeof object.sessionId === "string" ? object.sessionId : undefined);
      case "extensions.catalog": {
        if (object.sessionId !== undefined && (typeof object.sessionId !== "string" || !object.sessionId)) throw new Error("A valid session id is required.");
        return this.runtime.extensions.list(object.sessionId as string | undefined);
      }
      case "extensions.install": {
        if (typeof object.sessionId !== "string" || !object.sessionId || typeof object.extensionId !== "string") throw new Error("A session and catalog extension id are required.");
        return this.runtime.extensions.install(object.sessionId, object.extensionId, object.userApproved);
      }
      case "tools.list": {
        const session = typeof object.sessionId === "string" ? this.runtime.getSession(object.sessionId) : undefined;
        return this.runtime.tools.list(session?.projectPath);
      }
      case "mcp.list": {
        const session = typeof object.sessionId === "string" ? this.runtime.getSession(object.sessionId) : undefined;
        if (!session) throw new Error("An active workspace session is required to list MCP servers.");
        return this.runtime.mcp.list(session.projectPath);
      }
      case "mcp.save": {
        if (!object.server || typeof object.server !== "object" || Array.isArray(object.server)) throw new Error("An MCP server configuration is required.");
        return this.runtime.mcp.save(object.server as Parameters<HarnessRuntime["mcp"]["save"]>[0]);
      }
      case "mcp.connect": {
        if (typeof object.serverId !== "string") throw new Error("An MCP server id is required.");
        return this.runtime.mcp.connect(object.serverId);
      }
      case "mcp.disconnect": {
        if (typeof object.serverId !== "string") throw new Error("An MCP server id is required.");
        return this.runtime.mcp.disconnect(object.serverId);
      }
      case "mcp.delete": {
        if (typeof object.serverId !== "string") throw new Error("An MCP server id is required.");
        return this.runtime.mcp.delete(object.serverId);
      }
      case "mcp.credentials.configure": {
        if (typeof object.serverId !== "string") throw new Error("An MCP server id is required.");
        return this.runtime.mcp.configureCredentials(object.serverId, object.credentials);
      }
      case "mcp.credentials.restoreList": return this.runtime.persistence.listMcpServers().map(({ id, secretKeys }) => ({ id, secretKeys }));
      case "marketplace.search": {
        const session = typeof object.sessionId === "string" ? this.runtime.getSession(object.sessionId) : undefined;
        if (!session) throw new Error("An active workspace session is required to search the MCP Marketplace.");
        return this.runtime.marketplace.search(session.projectPath, String(object.query ?? ""));
      }
      case "marketplace.install": {
        const session = typeof object.sessionId === "string" ? this.runtime.getSession(object.sessionId) : undefined;
        if (!session || typeof object.serverName !== "string" || typeof object.packageVersion !== "string") throw new Error("An active workspace session, server name, and package version are required.");
        return this.runtime.marketplace.install(session.projectPath, object.serverName, object.packageVersion);
      }
      case "release.credentials.configure":
        if (typeof object.projectPath !== "string") throw new Error("A workspace path is required to configure its Vercel Deploy Hook.");
        return this.runtime.release.configureDeployHook(object.projectPath, object.deployHookUrl);
      case "agents.list": return this.runtime.agents.list();
      case "agents.save": {
        if (!object.profile || typeof object.profile !== "object" || Array.isArray(object.profile)) throw new Error("A custom agent profile is required.");
        return this.runtime.agents.save(object.profile as AgentProfileDraft);
      }
      case "agents.test": {
        if (typeof object.sessionId !== "string" || typeof object.prompt !== "string") throw new Error("A session, agent draft or profile, and test prompt are required.");
        if (typeof object.agentId === "string") return this.runtime.testAgent(object.sessionId, object.agentId, object.prompt);
        if (!object.profile || typeof object.profile !== "object" || Array.isArray(object.profile)) throw new Error("A custom agent draft or profile is required.");
        return this.runtime.testAgent(object.sessionId, object.profile as AgentProfileDraft, object.prompt);
      }
      case "agents.delete": {
        if (typeof object.agentId !== "string") throw new Error("An agent id is required.");
        return this.runtime.agents.delete(object.agentId);
      }
      case "tool.invoke": {
        if (typeof object.name !== "string" || !object.input || typeof object.input !== "object" || Array.isArray(object.input)) throw new Error("A tool name and object input are required.");
        return this.runtime.invokeTool(String(object.sessionId), object.name, object.input as Record<string, unknown>, "general", object.trackActivity !== false);
      }
      case "terminal.consumeAuthorization": {
        const sessionId = String(object.sessionId ?? "");
        const session = this.runtime.getSession(sessionId);
        if (typeof object.authorizationId !== "string" || typeof object.projectPath !== "string" || typeof object.shell !== "string" || session.projectPath !== object.projectPath) return false;
        return this.runtime.tools.consumeTerminalAuthorization(object.authorizationId, sessionId, session.projectPath, object.shell);
      }
      case "code.index": {
        const session = this.runtime.getSession(String(object.sessionId));
        return this.runtime.code.index(session.projectPath);
      }
      case "code.search": {
        const session = this.runtime.getSession(String(object.sessionId));
        return this.runtime.code.search(session.projectPath, String(object.query ?? ""));
      }
      case "code.graph": {
        const session = this.runtime.getSession(String(object.sessionId));
        return this.runtime.code.graph(session.projectPath, String(object.query ?? ""));
      }
      case "skills.list": {
        const session = this.runtime.getSession(String(object.sessionId));
        return this.runtime.skills.list(session.projectPath);
      }
      case "skills.read": {
        const session = this.runtime.getSession(String(object.sessionId));
        if (typeof object.skillId !== "string") throw new Error("A skill path is required.");
        return this.runtime.skills.read(session.projectPath, object.skillId);
      }
      case "skills.setEnabled": {
        const session = this.runtime.getSession(String(object.sessionId));
        if (typeof object.skillId !== "string" || typeof object.enabled !== "boolean") throw new Error("A skill path and enabled state are required.");
        return this.runtime.skills.setEnabled(session.projectPath, object.skillId, object.enabled);
      }
      case "providers.list": return this.runtime.providers.list();
      case "provider.configure": {
        if (typeof object.providerId !== "string") throw new Error("A provider id is required.");
        if (object.apiKey !== null && typeof object.apiKey !== "string") throw new Error("An API key or null is required.");
        if (typeof object.apiKey === "string" && (object.apiKey.trim().length < 1 || object.apiKey.length > 4096 || object.apiKey.includes("\0"))) throw new Error("The API key must contain between 1 and 4096 valid characters.");
        this.runtime.providers.setCredential(object.providerId, typeof object.apiKey === "string" ? object.apiKey.trim() : undefined);
        return this.runtime.providers.list().find((item) => item.id === object.providerId);
      }
      case "provider.auth.configure": {
        if (object.providerId !== "openai_chatgpt" && object.providerId !== "xai_plan") throw new Error("Unsupported account provider.");
        if (object.credential !== null && (!object.credential || typeof object.credential !== "object" || Array.isArray(object.credential))) throw new Error("An account credential or null is required.");
        this.runtime.providers.setOAuthCredential(object.providerId, object.credential as import("./providers.js").ChatGPTOAuthCredential | import("./providers.js").XaiOAuthCredential | null);
        return this.runtime.providers.list().find((item) => item.id === object.providerId);
      }
      case "provider.custom.create": {
        if (typeof object.label !== "string" || typeof object.baseUrl !== "string") throw new Error("A provider name and compatible API endpoint are required.");
        return this.runtime.createCustomProvider({ label: object.label, baseUrl: object.baseUrl });
      }
      case "provider.custom.delete": {
        if (typeof object.providerId !== "string") throw new Error("A custom provider id is required.");
        return this.runtime.deleteCustomProvider(object.providerId);
      }
      case "provider.models": {
        const provider = this.runtime.providers.get(String(object.providerId));
        if (!provider) throw new Error(`Provider not found: ${String(object.providerId)}`);
        return provider.listModels();
      }
      case "shutdown":
        for (const controller of this.controllers.values()) controller.abort();
        await this.runtime.close();
        return { ok: true };
      default: throw new Error(`Unknown JSON-RPC method: ${method}`);
    }
  }
}
