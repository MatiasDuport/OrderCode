import { randomUUID } from "node:crypto";
import { HarnessError } from "./errors.js";
import type { CustomProviderConfig, ProviderModel, ProviderRequest, ProviderToolCall, ProviderTurn, ToolDefinition } from "./types.js";

export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly configured: boolean;
  setCredential?(key: string | undefined): void;
  complete(request: ProviderRequest): Promise<ProviderTurn>;
  stream(request: ProviderRequest, onChunk: (chunk: string) => void): Promise<ProviderTurn>;
  listModels(signal?: AbortSignal): Promise<ProviderModel[]>;
}

export interface ProviderRegistryOptions {
  adapters?: ProviderAdapter[];
  onOAuthTokensRotated?: (credential: ChatGPTOAuthCredential) => void;
}

export interface ChatGPTOAuthCredential {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  clientId: string;
  subject: string;
  email?: string;
  hostId: string;
  expiresAt: number;
  scopes: string[];
}

export interface CustomProviderInput { id?: string; label: string; baseUrl: string }

function envKey(providerId: string): string | undefined {
  const keyName = `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  return process.env[keyName] || (providerId === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined) || (providerId === "openai" ? process.env.OPENAI_API_KEY : undefined) || (providerId === "opencode_zen" ? process.env.OPENCODE_API_KEY : undefined);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be an object.");
      return parsed as Record<string, unknown>;
    } catch (error) {
      throw new HarnessError("INVALID_PROVIDER_RESPONSE", "The provider returned malformed tool arguments.", { diagnostics: error instanceof Error ? error.message : String(error) });
    }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function wireToolName(name: string): string { return name.replace(/[^A-Za-z0-9_-]/g, "_"); }

function pricePerMillion(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : undefined;
}

// OpenCode's live model endpoint omits prices. Keep this allowlist aligned with its published free-price table,
// and only expose models that also appear in the live catalog. Never infer free access from an ID suffix.
const OPENCODE_ZEN_FREE_CHAT_MODELS = new Map<string, string>([
  ["big-pickle", "Big Pickle"],
  ["glm-5.3-flash-free", "GLM 5.3 Flash Free"],
  ["deepseek-v4.1-flash-free", "DeepSeek V4.1 Flash Free"],
  ["space-bunny-free", "Space Bunny Free"],
  ["beam-free", "Beam Free"],
  ["ll-alpha-free", "LL Alpha Free"],
  ["longcat-2.5-preview-free", "LongCat 2.5 Preview Free"],
  ["exo-free", "Exo Free"],
  ["mimo-v2.6-flash-free", "MiMo V2.6 Flash Free"],
  ["mimo-v2.5-free", "MiMo V2.5 Free"],
  ["nemotron-3-ultra-free", "Nemotron 3 Ultra Free"],
  ["nemotron-3.5-lightning-free", "Nemotron 3.5 Lightning Free"],
  ["nemotron-3.5-super-vl-free", "Nemotron 3.5 Super VL Free"],
  ["jev-1.13-free", "Jev 1.13 Free"],
]);

function mapToolNames(tools: ToolDefinition[]): { wire: ToolDefinition[]; decode: (value: string) => string } {
  const names = new Map(tools.map((tool) => [wireToolName(tool.name), tool.name]));
  return { wire: tools.map((tool) => ({ ...tool, name: wireToolName(tool.name) })), decode: (value) => names.get(value) ?? value };
}

function toOpenAIMessages(messages: ProviderRequest["messages"]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolName ? { name: wireToolName(message.toolName) } : {}),
    ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: wireToolName(call.name), arguments: JSON.stringify(call.arguments) } })) } : {}),
  }));
}

/** OpenAI's documented open-source Sign in with ChatGPT plan-sharing flow. */
export class ChatGPTPlanProvider implements ProviderAdapter {
  readonly id = "openai_chatgpt";
  readonly label = "ChatGPT plan";
  readonly baseUrl = "https://api.openai.com/v1";
  configured = false;
  private credential?: ChatGPTOAuthCredential;
  private refreshing?: Promise<void>;

  constructor(private readonly onTokensRotated?: (credential: ChatGPTOAuthCredential) => void) {}

  setOAuthCredential(credential: ChatGPTOAuthCredential | null): void {
    this.credential = credential ?? undefined;
    this.configured = Boolean(credential?.accessToken && credential.refreshToken && credential.clientId && credential.scopes.includes("chatgpt.tokens.use.direct"));
  }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    if (!this.configured) return [];
    const response = await fetch(`${this.baseUrl}/models`, { headers: { authorization: `Bearer ${await this.accessToken(signal)}`, accept: "application/json" }, signal, redirect: "error" });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `ChatGPT model discovery failed (${response.status}).`, { providerId: this.id, status: response.status, diagnostics: (await response.text()).slice(0, 2_000) });
    const payload = await response.json() as { models?: Array<{ slug?: string; display_name?: string; visibility?: string }> };
    return (payload.models ?? []).filter((model) => typeof model.slug === "string" && model.visibility === "list").map((model) => ({ id: model.slug!, providerId: this.id, label: model.display_name ?? model.slug!, capabilities: ["chat", "streaming", "tool-calling"], available: true, priceKind: "subscription" }));
  }

  async complete(request: ProviderRequest): Promise<ProviderTurn> {
    return this.stream(request, () => undefined);
  }

  async stream(request: ProviderRequest, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    if (!this.configured) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Sign in with ChatGPT in Settings to use your ChatGPT plan.");
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).filter(Boolean).join("\n\n");
    const input: Array<Record<string, unknown>> = [];
    for (const message of request.messages) {
      if (message.role === "system") continue;
      if (message.role === "tool") {
        input.push({ type: "function_call_output", call_id: message.toolCallId ?? "", output: message.content });
        continue;
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        for (const call of message.toolCalls) input.push({ type: "function_call", call_id: call.id, name: wireToolName(call.name), arguments: JSON.stringify(call.arguments) });
        if (message.content) input.push({ role: "assistant", content: message.content });
        continue;
      }
      input.push({ role: message.role, content: message.content });
    }
    const toolMap = request.tools?.length ? mapToolNames(request.tools) : undefined;
    const payload: Record<string, unknown> = { model: request.model, input, store: false, stream: true,
      ...(system ? { instructions: system } : {}),
      ...(toolMap ? { tools: toolMap.wire.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false })) } : {}),
    };
    let token = await this.accessToken(request.signal);
    let response = await this.send(payload, token, request.signal);
    if (response.status === 401) {
      await response.body?.cancel();
      token = await this.accessToken(request.signal, true);
      response = await this.send(payload, token, request.signal);
    }
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `ChatGPT plan request failed (${response.status}).`, { providerId: this.id, status: response.status, diagnostics: (await response.text()).slice(0, 2_000) });
    if (!response.body) throw new HarnessError("PROVIDER_STREAM_UNAVAILABLE", "ChatGPT returned no response stream.");
    return parseChatGPTResponseStream(response.body, onChunk, toolMap?.decode);
  }

  private async send(payload: Record<string, unknown>, token: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}/responses`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(payload), signal, redirect: "error" });
  }

  private async accessToken(signal?: AbortSignal, forceRefresh = false): Promise<string> {
    if (!this.credential) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Sign in with ChatGPT in Settings to use your ChatGPT plan.");
    if (forceRefresh || this.credential.expiresAt <= Date.now() + 60_000) {
      if (!this.refreshing) this.refreshing = this.refreshCredential(signal).finally(() => { this.refreshing = undefined; });
      await this.refreshing;
    }
    if (!this.credential?.accessToken) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "The ChatGPT account needs to be reconnected in Settings.");
    return this.credential.accessToken;
  }

  private async refreshCredential(signal?: AbortSignal): Promise<void> {
    const current = this.credential;
    if (!current) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "The ChatGPT account needs to be reconnected in Settings.");
    const response = await fetch("https://auth.openai.com/api/accounts/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: current.clientId, resource: "https://api.openai.com/v1" }), signal, redirect: "error" });
    if (!response.ok) throw new HarnessError("PROVIDER_AUTH_EXPIRED", "The ChatGPT account could not refresh its session. Reconnect it in Settings.", { providerId: this.id, status: response.status, diagnostics: (await response.text()).slice(0, 1_000) });
    const tokens = await response.json() as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string };
    if (!tokens.access_token || !tokens.refresh_token) throw new HarnessError("INVALID_PROVIDER_RESPONSE", "ChatGPT returned an incomplete token refresh.");
    const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? current.scopes;
    if (!scopes.includes("chatgpt.tokens.use.direct")) throw new HarnessError("PROVIDER_AUTH_EXPIRED", "ChatGPT plan access is no longer authorized. Reconnect the account in Settings.");
    this.credential = { ...current, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000, scopes };
    this.onTokensRotated?.(this.credential);
  }
}

async function parseChatGPTResponseStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void, decodeToolName: (name: string) => string = (name) => name): Promise<ProviderTurn> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let completed = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cachedTokens: number | undefined;
  const calls = new Map<number, ProviderToolCall & { rawArguments: string }>();
  const consume = (block: string): void => {
    const lines = block.split(/\r?\n/);
    const eventType = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!eventType || !data || data === "[DONE]") return;
    const root = parseJsonObject(data);
    if (eventType === "response.output_text.delta" && typeof root.delta === "string") { content += root.delta; onChunk(root.delta); }
    if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
      const item = root.item && typeof root.item === "object" ? root.item as Record<string, unknown> : {};
      if (item.type === "function_call") {
        const index = Number(root.output_index ?? calls.size);
        const current = calls.get(index) ?? { id: String(item.call_id ?? `call_${index}`), name: String(item.name ?? ""), arguments: {}, rawArguments: "" };
        current.id = String(item.call_id ?? current.id);
        current.name = String(item.name ?? current.name);
        if (typeof item.arguments === "string" && !current.rawArguments) current.rawArguments = item.arguments;
        calls.set(index, current);
      }
    }
    if (eventType === "response.function_call_arguments.delta") {
      const index = Number(root.output_index ?? 0);
      const current = calls.get(index) ?? { id: String(root.call_id ?? `call_${index}`), name: String(root.name ?? ""), arguments: {}, rawArguments: "" };
      current.rawArguments += typeof root.delta === "string" ? root.delta : "";
      calls.set(index, current);
    }
    if (eventType === "response.completed") {
      completed = true;
      const response = root.response && typeof root.response === "object" ? root.response as Record<string, unknown> : {};
      const usage = response.usage && typeof response.usage === "object" ? response.usage as Record<string, unknown> : {};
      const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : {};
      if (typeof usage.input_tokens === "number") inputTokens = usage.input_tokens;
      if (typeof usage.output_tokens === "number") outputTokens = usage.output_tokens;
      if (typeof inputDetails.cached_tokens === "number") cachedTokens = inputDetails.cached_tokens;
    }
    if (eventType === "response.failed" || eventType === "error") {
      const response = root.response && typeof root.response === "object" ? root.response as Record<string, unknown> : root;
      const error = response.error && typeof response.error === "object" ? response.error as Record<string, unknown> : response;
      const code = String(error.code ?? "unknown_error");
      throw new HarnessError(code.startsWith("subscription_sharing_usage") ? "PROVIDER_USAGE_LIMIT" : "PROVIDER_ERROR", String(error.message ?? `ChatGPT response failed (${code}).`), { providerId: "openai_chatgpt", diagnostics: code });
    }
    if (eventType === "response.incomplete") throw new HarnessError("PROVIDER_INCOMPLETE", "ChatGPT ended the response before completing it.", { providerId: "openai_chatgpt" });
  };
  while (true) {
    const part = await reader.read();
    buffer += decoder.decode(part.value ?? new Uint8Array(), { stream: !part.done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consume(block);
    if (part.done) break;
  }
  if (buffer) consume(buffer);
  if (!completed) throw new HarnessError("PROVIDER_STREAM_INCOMPLETE", "ChatGPT's stream ended without a completed response.", { providerId: "openai_chatgpt" });
  const toolCalls = [...calls.values()].map((call) => ({ id: call.id, name: decodeToolName(call.name), arguments: parseToolArguments(call.rawArguments || call.arguments) })).filter((call) => call.name);
  return { content, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(cachedTokens === undefined ? {} : { cachedTokens }), costKind: "unknown" };
}

export class OpenAICompatibleProvider implements ProviderAdapter {
  configured: boolean;
  private apiKey?: string;

  constructor(
    readonly id: string,
    readonly label: string,
    baseUrl: string,
    apiKey = envKey(id),
    private readonly extraHeaders: Record<string, string> = {},
    private readonly allowUnauthenticated = false,
    private readonly modelsUrl?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.configured = Boolean(apiKey) || allowUnauthenticated;
  }

  readonly baseUrl: string;

  async complete(request: ProviderRequest): Promise<ProviderTurn> {
    return this.request(request, false, () => undefined);
  }

  async stream(request: ProviderRequest, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    return this.request(request, true, onChunk);
  }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    const local = this.id === "ollama" || this.id === "lmstudio" || this.allowUnauthenticated;
    // OpenRouter and OpenCode expose public model catalogs. Discovering them does not authorize inference;
    // their models remain unavailable until the user connects that provider's own API key.
    const publicCatalog = this.id === "openrouter" || this.id === "opencode_zen";
    if (!this.configured && !local && !publicCatalog) return [];
    const response = await fetch(this.modelsUrl ?? `${this.baseUrl}/models`, { headers: this.headers(), signal, redirect: "error" });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Model discovery failed (${response.status}).`, { providerId: this.id, status: response.status });
    const payload = await response.json() as { data?: Array<{ id?: string; pricing?: { prompt?: string | number; completion?: string | number } }> };
    return (payload.data ?? []).filter((model): model is { id: string; pricing?: { prompt?: string | number; completion?: string | number } } => typeof model.id === "string").flatMap((model) => {
      if (this.id === "opencode_zen") {
        const label = OPENCODE_ZEN_FREE_CHAT_MODELS.get(model.id);
        if (!label) return [];
        return [{
          id: model.id, providerId: this.id, label, capabilities: ["chat", "streaming", "tool-calling"], available: this.configured,
          priceKind: "free" as const,
          pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0, updatedAt: new Date().toISOString() },
        }];
      }
      const inputPerMillionUsd = this.id === "openrouter" ? pricePerMillion(model.pricing?.prompt) : undefined;
      const outputPerMillionUsd = this.id === "openrouter" ? pricePerMillion(model.pricing?.completion) : undefined;
      const verifiedPricing = inputPerMillionUsd !== undefined && outputPerMillionUsd !== undefined;
      const localModel = this.id === "ollama" || this.id === "lmstudio";
      return [{
        id: model.id, providerId: this.id, label: model.id, capabilities: ["chat", "streaming", "tool-calling"], available: this.configured || localModel,
        priceKind: localModel ? "local" : verifiedPricing ? (inputPerMillionUsd === 0 && outputPerMillionUsd === 0 ? "free" : "paid") : "unknown",
        ...(verifiedPricing ? { pricing: { inputPerMillionUsd, outputPerMillionUsd, updatedAt: new Date().toISOString() } } : {}),
      }];
    });
  }

  private async request(request: ProviderRequest, stream: boolean, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    const local = this.id === "ollama" || this.id === "lmstudio" || this.allowUnauthenticated;
    if (!this.apiKey && !local) throw new HarnessError("PROVIDER_NOT_CONFIGURED", `Provider ${this.id} is not configured. Supply its API key in Settings or via its environment variable.`);
    const mappedTools = request.tools?.length ? mapToolNames(request.tools) : undefined;
    const payload: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? 8192,
      messages: toOpenAIMessages(request.messages),
      stream,
      ...(stream && this.id === "openrouter" ? { stream_options: { include_usage: true } } : {}),
      ...(mappedTools ? { tools: mappedTools.wire.map(toOpenAITool) } : {}),
    };
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: request.signal,
      redirect: "error",
    });
    if (!response.ok) {
      const diagnostics = (await response.text()).slice(0, 2_000);
      throw new HarnessError("PROVIDER_ERROR", `Provider request failed (${response.status}).`, { providerId: this.id, status: response.status, diagnostics });
    }
    if (!stream) return parseCompletion(await response.json(), mappedTools?.decode, this.id === "openrouter");
    if (!response.body) throw new HarnessError("PROVIDER_STREAM_UNAVAILABLE", "Provider returned no response body for a streaming request.");
    return parseSseStream(response.body, onChunk, mappedTools?.decode, this.id === "openrouter");
  }

  private headers(): Record<string, string> {
    return { ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}), accept: "text/event-stream", ...this.extraHeaders };
  }

  setCredential(key: string | undefined): void { this.apiKey = key; this.configured = Boolean(key) || this.allowUnauthenticated; }
}

function toOpenAITool(definition: ToolDefinition): Record<string, unknown> {
  return { type: "function", function: { name: definition.name, description: definition.description, parameters: definition.inputSchema } };
}

function parseCompletion(payload: unknown, decodeToolName: (name: string) => string = (name) => name, includeCost = false): ProviderTurn {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const choice = Array.isArray(root.choices) ? root.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.map((call) => {
    const record = call as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object" ? record.function as Record<string, unknown> : {};
    return { id: String(record.id ?? `call_${Math.random().toString(36).slice(2)}`), name: decodeToolName(String(fn.name ?? "")), arguments: parseToolArguments(fn.arguments) } satisfies ProviderToolCall;
  }).filter((call) => call.name) : [];
  const usage = root.usage && typeof root.usage === "object" ? root.usage as Record<string, unknown> : {};
  const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" ? usage.prompt_tokens_details as Record<string, unknown> : {};
  const costUsd = includeCost && typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : undefined;
  return { content: typeof message.content === "string" ? message.content : "", toolCalls, finishReason: String(choice?.finish_reason ?? "stop"), ...(typeof usage.prompt_tokens === "number" ? { inputTokens: usage.prompt_tokens } : {}), ...(typeof usage.completion_tokens === "number" ? { outputTokens: usage.completion_tokens } : {}), ...(typeof promptDetails.cached_tokens === "number" ? { cachedTokens: promptDetails.cached_tokens } : {}), ...(costUsd === undefined ? {} : { costUsd, costKind: "exact" as const }), raw: payload };
}

async function parseSseStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void, decodeToolName: (name: string) => string = (name) => name, includeCost = false): Promise<ProviderTurn> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason = "stop";
  const calls = new Map<number, ProviderToolCall>();
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cachedTokens: number | undefined;
  let costUsd: number | undefined;
  const consume = (block: string): void => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
    if (!data || data === "[DONE]") return;
    const root = parseJsonObject(data);
    const choice = Array.isArray(root.choices) ? root.choices[0] as Record<string, unknown> | undefined : undefined;
    const delta = choice?.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
    if (typeof delta.content === "string") { content += delta.content; onChunk(delta.content); }
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
    if (Array.isArray(delta.tool_calls)) for (const rawCall of delta.tool_calls) {
      const call = rawCall as Record<string, unknown>;
      const index = Number(call.index ?? 0);
      const current = calls.get(index) ?? { id: String(call.id ?? `call_${index}`), name: "", arguments: {} };
      const fn = call.function && typeof call.function === "object" ? call.function as Record<string, unknown> : {};
      if (typeof call.id === "string") current.id = call.id;
      if (typeof fn.name === "string") current.name += fn.name;
      if (typeof fn.arguments === "string") (current as ProviderToolCall & { rawArguments?: string }).rawArguments = `${(current as ProviderToolCall & { rawArguments?: string }).rawArguments ?? ""}${fn.arguments}`;
      calls.set(index, current);
    }
    const usage = root.usage && typeof root.usage === "object" ? root.usage as Record<string, unknown> : {};
    if (typeof usage.prompt_tokens === "number") inputTokens = usage.prompt_tokens;
    if (typeof usage.completion_tokens === "number") outputTokens = usage.completion_tokens;
    const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" ? usage.prompt_tokens_details as Record<string, unknown> : {};
    if (typeof promptDetails.cached_tokens === "number") cachedTokens = promptDetails.cached_tokens;
    if (includeCost && typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) costUsd = usage.cost;
  };
  while (true) {
    const read = await reader.read();
    buffer += decoder.decode(read.value ?? new Uint8Array(), { stream: !read.done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consume(block);
    if (read.done) break;
  }
  if (buffer) consume(buffer);
  const toolCalls = [...calls.values()].map((call) => {
    const rawArguments = (call as ProviderToolCall & { rawArguments?: string }).rawArguments;
    if (rawArguments !== undefined) call.arguments = parseToolArguments(rawArguments);
    call.name = decodeToolName(call.name);
    return call;
  }).filter((call) => call.name);
  return { content, toolCalls, finishReason, ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(cachedTokens === undefined ? {} : { cachedTokens }), ...(costUsd === undefined ? {} : { costUsd, costKind: "exact" as const }) };
}

class AnthropicProvider implements ProviderAdapter {
  readonly id = "anthropic";
  readonly label = "Anthropic";
  readonly baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
  private apiKey = envKey(this.id);
  configured = Boolean(this.apiKey);

  async complete(request: ProviderRequest): Promise<ProviderTurn> { return this.request(request, false, () => undefined); }
  async stream(request: ProviderRequest, onChunk: (chunk: string) => void): Promise<ProviderTurn> { return this.request(request, true, onChunk); }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    if (!this.configured) return [];
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/models?limit=100`, { headers: this.headers(), signal });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Anthropic model discovery failed (${response.status}).`);
    const data = await response.json() as { data?: Array<{ id?: string; display_name?: string }> };
    return (data.data ?? []).filter((model): model is { id: string; display_name?: string } => typeof model.id === "string").map((model) => ({ id: model.id, providerId: this.id, label: model.display_name ?? model.id, capabilities: ["chat", "streaming", "tool-calling"], available: true, priceKind: "unknown" }));
  }

  private async request(request: ProviderRequest, streaming: boolean, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    if (!this.apiKey) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Anthropic API credentials are not configured.");
    const mapped = request.tools?.length ? mapToolNames(request.tools) : undefined;
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const messages = request.messages.filter((message) => message.role !== "system").map((message) => {
      if (message.role === "tool") return { role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] };
      if (message.role === "assistant" && message.toolCalls?.length) return { role: "assistant", content: [...(message.content ? [{ type: "text", text: message.content }] : []), ...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: wireToolName(call.name), input: call.arguments }))] };
      return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
    });
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST", headers: { ...this.headers(), "content-type": "application/json" }, signal: request.signal,
      body: JSON.stringify({ model: request.model, max_tokens: request.maxOutputTokens ?? 8192, messages, ...(system ? { system } : {}), ...(streaming ? { stream: true } : {}), ...(mapped ? { tools: mapped.wire.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) } : {}) }),
    });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Anthropic request failed (${response.status}).`, { diagnostics: (await response.text()).slice(0, 2_000) });
    if (!streaming) return parseAnthropicTurn(await response.json(), mapped?.decode);
    if (!response.body) throw new HarnessError("PROVIDER_STREAM_UNAVAILABLE", "Anthropic returned no streaming response body.");
    return parseAnthropicStream(response.body, onChunk, mapped?.decode);
  }

  private headers(): Record<string, string> { return { "x-api-key": this.apiKey ?? "", "anthropic-version": "2023-06-01", accept: "text/event-stream" }; }

  setCredential(key: string | undefined): void { this.apiKey = key; this.configured = Boolean(key); }
}

function parseAnthropicTurn(value: unknown, decode: (name: string) => string = (name) => name): ProviderTurn {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const blocks = Array.isArray(root.content) ? root.content as Array<Record<string, unknown>> : [];
  const usage = root.usage && typeof root.usage === "object" ? root.usage as Record<string, unknown> : {};
  return {
    content: blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text as string).join(""),
    toolCalls: blocks.filter((block) => block.type === "tool_use" && typeof block.name === "string").map((block) => ({ id: String(block.id), name: decode(String(block.name)), arguments: block.input && typeof block.input === "object" ? block.input as Record<string, unknown> : {} })),
    finishReason: String(root.stop_reason ?? "stop"), ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}), ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}), ...(typeof usage.cache_read_input_tokens === "number" ? { cachedTokens: usage.cache_read_input_tokens } : {}), raw: value,
  };
}

async function parseAnthropicStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void, decode: (name: string) => string = (name) => name): Promise<ProviderTurn> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let content = ""; let stopReason = "stop"; let inputTokens: number | undefined; let outputTokens: number | undefined; let cachedTokens: number | undefined;
  const calls = new Map<number, { id: string; name: string; raw: string }>(); let blockIndex = -1;
  const consume = (block: string) => {
    const lines = block.split(/\r?\n/); const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim(); const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join(""); if (!data) return;
    let root: Record<string, unknown>; try { root = JSON.parse(data) as Record<string, unknown>; } catch { throw new HarnessError("INVALID_PROVIDER_RESPONSE", "Anthropic sent invalid streaming data."); }
    if (event === "message_start") { const message = root.message as Record<string, unknown> | undefined; const usage = message?.usage as Record<string, unknown> | undefined; if (typeof usage?.input_tokens === "number") inputTokens = usage.input_tokens; if (typeof usage?.cache_read_input_tokens === "number") cachedTokens = usage.cache_read_input_tokens; }
    if (event === "content_block_start") { blockIndex = Number(root.index ?? blockIndex + 1); const block = root.content_block as Record<string, unknown> | undefined; if (block?.type === "tool_use") calls.set(blockIndex, { id: String(block.id), name: String(block.name), raw: "" }); }
    if (event === "content_block_delta") { const delta = root.delta as Record<string, unknown> | undefined; if (delta?.type === "text_delta" && typeof delta.text === "string") { content += delta.text; onChunk(delta.text); } if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") { const call = calls.get(Number(root.index ?? blockIndex)); if (call) call.raw += delta.partial_json; } }
    if (event === "message_delta") { const delta = root.delta as Record<string, unknown> | undefined; if (typeof delta?.stop_reason === "string") stopReason = delta.stop_reason; const usage = root.usage as Record<string, unknown> | undefined; if (typeof usage?.output_tokens === "number") outputTokens = usage.output_tokens; if (typeof usage?.cache_read_input_tokens === "number") cachedTokens = usage.cache_read_input_tokens; }
  };
  while (true) { const part = await reader.read(); buffer += decoder.decode(part.value ?? new Uint8Array(), { stream: !part.done }); const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() ?? ""; for (const block of blocks) consume(block); if (part.done) break; }
  if (buffer) consume(buffer);
  const toolCalls = [...calls.values()].map((call) => ({ id: call.id, name: decode(call.name), arguments: parseToolArguments(call.raw || "{}") }));
  return { content, toolCalls, finishReason: stopReason, ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(cachedTokens === undefined ? {} : { cachedTokens }) };
}

class GeminiProvider implements ProviderAdapter {
  readonly id = "gemini";
  readonly label = "Google Gemini";
  readonly baseUrl = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  private apiKey = envKey(this.id) ?? process.env.GOOGLE_API_KEY;
  configured = Boolean(this.apiKey);

  async complete(request: ProviderRequest): Promise<ProviderTurn> { return this.request(request, false, () => undefined); }
  async stream(request: ProviderRequest, onChunk: (chunk: string) => void): Promise<ProviderTurn> { return this.request(request, true, onChunk); }
  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    if (!this.apiKey) return [];
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/models`, { headers: { "x-goog-api-key": this.apiKey }, signal });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Gemini model discovery failed (${response.status}).`);
    const data = await response.json() as { models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }> };
    return (data.models ?? []).filter((model) => typeof model.name === "string" && (model.supportedGenerationMethods ?? []).includes("generateContent")).map((model) => ({ id: model.name!.replace(/^models\//, ""), providerId: this.id, label: model.displayName ?? model.name!, capabilities: model.supportedGenerationMethods ?? [], available: true, priceKind: "unknown" }));
  }
  private async request(request: ProviderRequest, streaming: boolean, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    if (!this.apiKey) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Google Gemini API credentials are not configured.");
    const tools = request.tools?.length ? mapToolNames(request.tools) : undefined;
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const contents = request.messages.filter((message) => message.role !== "system").map((message) => {
      if (message.role === "tool") return { role: "user", parts: [{ functionResponse: { name: wireToolName(message.toolName ?? "tool"), response: { result: message.content } } }] };
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) parts.push({ text: message.content });
      if (message.role === "assistant") for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: wireToolName(call.name), args: call.arguments } });
      return { role: message.role === "assistant" ? "model" : "user", parts };
    });
    const method = streaming ? "streamGenerateContent?alt=sse" : "generateContent";
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(request.model)}:${method}`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: request.maxOutputTokens ?? 8192 }, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), ...(tools ? { tools: [{ functionDeclarations: tools.wire.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }] } : {}) }), signal: request.signal });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Gemini request failed (${response.status}).`, { diagnostics: (await response.text()).slice(0, 2_000) });
    if (!streaming) return parseGeminiTurn(await response.json(), tools?.decode);
    if (!response.body) throw new HarnessError("PROVIDER_STREAM_UNAVAILABLE", "Gemini returned no streaming response body.");
    return parseGeminiStream(response.body, onChunk, tools?.decode);
  }

  setCredential(key: string | undefined): void { this.apiKey = key; this.configured = Boolean(key); }
}

function parseGeminiTurn(value: unknown, decode: (name: string) => string = (name) => name): ProviderTurn {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {}; const candidates = root.candidates as Array<Record<string, unknown>> | undefined; const candidate = candidates?.[0]; const content = candidate?.content as Record<string, unknown> | undefined; const parts = Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : []; const usage = root.usageMetadata as Record<string, unknown> | undefined;
  const calls = parts.filter((part) => part.functionCall && typeof part.functionCall === "object").map((part) => { const call = part.functionCall as Record<string, unknown>; return { id: `gemini_${randomUUID()}`, name: decode(String(call.name ?? "")), arguments: call.args && typeof call.args === "object" ? call.args as Record<string, unknown> : {} }; }).filter((call) => call.name);
  return { content: parts.filter((part) => typeof part.text === "string").map((part) => part.text as string).join(""), toolCalls: calls, finishReason: String(candidate?.finishReason ?? "stop"), ...(typeof usage?.promptTokenCount === "number" ? { inputTokens: usage.promptTokenCount } : {}), ...(typeof usage?.candidatesTokenCount === "number" ? { outputTokens: usage.candidatesTokenCount } : {}), ...(typeof usage?.cachedContentTokenCount === "number" ? { cachedTokens: usage.cachedContentTokenCount } : {}), raw: value };
}

async function parseGeminiStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void, decode?: (name: string) => string): Promise<ProviderTurn> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let content = ""; const calls: ProviderToolCall[] = []; let inputTokens: number | undefined; let outputTokens: number | undefined; let cachedTokens: number | undefined;
  const consume = (data: string) => { if (!data.trim()) return; let root: unknown; try { root = JSON.parse(data); } catch { throw new HarnessError("INVALID_PROVIDER_RESPONSE", "Gemini sent invalid streaming data."); } const turn = parseGeminiTurn(root, decode); if (turn.content) { content += turn.content; onChunk(turn.content); } calls.push(...turn.toolCalls); if (turn.inputTokens !== undefined) inputTokens = turn.inputTokens; if (turn.outputTokens !== undefined) outputTokens = turn.outputTokens; if (turn.cachedTokens !== undefined) cachedTokens = turn.cachedTokens; };
  while (true) { const part = await reader.read(); buffer += decoder.decode(part.value ?? new Uint8Array(), { stream: !part.done }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ""; for (const line of lines) if (line.startsWith("data:")) consume(line.slice(5).trim()); if (part.done) break; }
  if (buffer.startsWith("data:")) consume(buffer.slice(5).trim());
  return { content, toolCalls: calls, finishReason: "stop", ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(cachedTokens === undefined ? {} : { cachedTokens }) };
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(options: ProviderRegistryOptions = {}) {
    const configured = options.adapters ?? defaultAdapters(options.onOAuthTokensRotated);
    for (const adapter of configured) this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ProviderAdapter | undefined { return this.adapters.get(id); }
  list(): Array<Pick<ProviderAdapter, "id" | "label" | "baseUrl" | "configured"> & { custom: boolean }> { return [...this.adapters.values()].map(({ id, label, baseUrl, configured }) => ({ id, label, baseUrl, configured, custom: id.startsWith("custom_") })); }
  createCustomEndpoint(input: Omit<CustomProviderConfig, "id">): CustomProviderConfig {
    const config = normalizeCustomProvider({ id: `custom_${randomUUID().replaceAll("-", "")}`, ...input });
    this.registerCustomEndpoint(config);
    return config;
  }
  registerCustomEndpoint(config: CustomProviderConfig): ProviderAdapter {
    const normalized = normalizeCustomProvider(config);
    const isLocal = isLoopbackEndpoint(normalized.baseUrl);
    const adapter = new OpenAICompatibleProvider(normalized.id, normalized.label, normalized.baseUrl, "", {}, isLocal);
    this.adapters.set(normalized.id, adapter);
    return adapter;
  }
  removeCustomEndpoint(id: string): boolean {
    if (!/^custom_[A-Za-z0-9_-]{8,80}$/.test(id)) throw new HarnessError("INVALID_PROVIDER_ID", "Only a compatible custom endpoint can be removed here.");
    return this.adapters.delete(id);
  }
  setCredential(id: string, key: string | undefined): void {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new HarnessError("PROVIDER_NOT_FOUND", `Provider not found: ${id}`);
    if (!adapter.setCredential) throw new HarnessError("PROVIDER_CREDENTIAL_UNSUPPORTED", `Provider ${id} does not support API keys.`);
    adapter.setCredential(key);
  }
  setOAuthCredential(id: string, credential: ChatGPTOAuthCredential | null): void {
    if (id !== "openai_chatgpt") throw new HarnessError("PROVIDER_AUTH_UNSUPPORTED", `Provider ${id} does not support account authorization.`);
    const adapter = this.adapters.get(id);
    if (!(adapter instanceof ChatGPTPlanProvider)) throw new HarnessError("PROVIDER_NOT_FOUND", `Provider not found: ${id}`);
    if (credential && (!credential.accessToken || !credential.refreshToken || !credential.idToken || !credential.clientId || !credential.subject || !credential.hostId || !Number.isFinite(credential.expiresAt) || !Array.isArray(credential.scopes) || !credential.scopes.includes("chatgpt.tokens.use.direct"))) {
      throw new HarnessError("INVALID_PROVIDER_CREDENTIAL", "A valid ChatGPT plan credential is required.");
    }
    adapter.setOAuthCredential(credential);
  }
}

export function normalizeCustomProvider(input: CustomProviderConfig): CustomProviderConfig {
  if (!input || typeof input !== "object" || typeof input.id !== "string" || !/^custom_[A-Za-z0-9_-]{8,80}$/.test(input.id)) throw new HarnessError("INVALID_PROVIDER_ID", "A valid custom provider id is required.");
  if (typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(input.label)) throw new HarnessError("INVALID_PROVIDER_LABEL", "Provider names must contain between 1 and 80 printable characters.");
  if (typeof input.baseUrl !== "string" || input.baseUrl.length > 2_000 || /[\u0000-\u0020\u007f]/.test(input.baseUrl)) throw new HarnessError("INVALID_PROVIDER_ENDPOINT", "A valid compatible API endpoint is required.");
  let url: URL;
  try { url = new URL(input.baseUrl); } catch { throw new HarnessError("INVALID_PROVIDER_ENDPOINT", "A valid compatible API endpoint is required."); }
  const loopback = isLoopbackHostname(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || !url.hostname || url.username || url.password || url.search || url.hash) throw new HarnessError("INVALID_PROVIDER_ENDPOINT", "Compatible endpoints must use HTTPS; HTTP is allowed only for loopback services, without credentials or query parameters.");
  return { id: input.id, label: input.label.trim(), baseUrl: url.toString().replace(/\/+$/, "") };
}

function isLoopbackEndpoint(value: string): boolean {
  try { return isLoopbackHostname(new URL(value).hostname); } catch { return false; }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "127.0.0.1" || normalized === "::1";
}

function defaultAdapters(onOAuthTokensRotated?: (credential: ChatGPTOAuthCredential) => void): ProviderAdapter[] {
  return [
    new OpenAICompatibleProvider("openai", "OpenAI", process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"),
    new ChatGPTPlanProvider(onOAuthTokensRotated),
    new OpenAICompatibleProvider("openrouter", "OpenRouter", process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1", undefined, { "HTTP-Referer": "https://ordercode.local", "X-Title": "OrderCode" }),
    new OpenAICompatibleProvider("opencode_zen", "OpenCode", process.env.OPENCODE_ZEN_BASE_URL ?? "https://opencode.ai/inference/openai/v1", undefined, {}, false, process.env.OPENCODE_ZEN_MODELS_URL ?? "https://opencode.ai/inference/v1/models"),
    new OpenAICompatibleProvider("deepseek", "DeepSeek", process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1"),
    new OpenAICompatibleProvider("mistral", "Mistral AI", process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1"),
    new OpenAICompatibleProvider("groq", "Groq", process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1"),
    new OpenAICompatibleProvider("together", "Together AI", process.env.TOGETHER_BASE_URL ?? "https://api.together.xyz/v1"),
    new OpenAICompatibleProvider("fireworks", "Fireworks AI", process.env.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference/v1"),
    new OpenAICompatibleProvider("cerebras", "Cerebras", process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1"),
    new OpenAICompatibleProvider("xai", "xAI", process.env.XAI_BASE_URL ?? "https://api.x.ai/v1"),
    new AnthropicProvider(),
    new GeminiProvider(),
    new OpenAICompatibleProvider("ollama", "Ollama", process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1"),
    new OpenAICompatibleProvider("lmstudio", "LM Studio", process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1"),
  ];
}

export function clearProviderSecretsFromEnvironment(): void {
  for (const name of ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "OPENCODE_ZEN_API_KEY", "OPENCODE_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "FIREWORKS_API_KEY", "CEREBRAS_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OLLAMA_API_KEY", "LMSTUDIO_API_KEY"]) delete process.env[name];
}

