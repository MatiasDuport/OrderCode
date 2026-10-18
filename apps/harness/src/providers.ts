import { createHash, randomUUID } from "node:crypto";
import { HarnessError } from "./errors.js";
import { catalogReasoningEfforts, nativeReasoningEfforts, validateReasoningEffort } from "./reasoning.js";
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
  onXaiOAuthTokensRotated?: (credential: XaiOAuthCredential) => void;
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

export interface XaiOAuthCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  connectionId: string;
}

export interface CustomProviderInput { id?: string; label: string; baseUrl: string }

function envKey(providerId: string): string | undefined {
  const keyName = `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  return process.env[keyName] || (providerId === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined) || (providerId === "openai" ? process.env.OPENAI_API_KEY : undefined) || (providerId === "opencode_zen" ? process.env.OPENCODE_API_KEY : undefined);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
    return value as Record<string, unknown>;
  } catch { throw new HarnessError("INVALID_PROVIDER_RESPONSE", "The provider returned invalid JSON."); }
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
  if (value !== undefined && value !== null && (typeof value !== "object" || Array.isArray(value))) throw new HarnessError("INVALID_PROVIDER_RESPONSE", "Tool arguments must be an object.");
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function wireToolName(name: string): string {
  return `${name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 47)}_${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
}

function discoverySignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(15_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function waitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason ?? new DOMException("The request was aborted.", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}

function rejectProviderError(root: Record<string, unknown>): void {
  if (!root.error) return;
  const error = typeof root.error === "object" ? root.error as Record<string, unknown> : {};
  throw new HarnessError("PROVIDER_ERROR", String(error.message ?? root.error), { diagnostics: String(error.code ?? error.type ?? "provider_error") });
}

/** Reads SSE frames across arbitrary UTF-8/network boundaries and always releases the response. */
async function readSse(body: ReadableStream<Uint8Array>, consume: (data: string, event?: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frame = (block: string) => {
    const lines = block.split(/\r?\n/);
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (data) consume(data, lines.find((line) => line.startsWith("event:"))?.slice(6).trim());
  };
  try {
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value ?? new Uint8Array(), { stream: !part.done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) frame(block);
      if (part.done) break;
    }
    if (buffer) frame(buffer);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function pricePerMillion(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : undefined;
}

// The public API omits prices. Join the provider's current endpoint and pricing tables;
// names ending in "free" and old promotions are insufficient evidence of a zero price.
async function openCodeCatalog(url: string, signal?: AbortSignal): Promise<{ freeModels: Map<string, string>; chatModels: Map<string, string> }> {
  const response = await fetch(url, { headers: { accept: "text/html" }, signal: discoverySignal(signal), redirect: "error" });
  if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `OpenCode pricing verification failed (${response.status}).`);
  const html = await response.text();
  const cells = (row: string) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]!.replace(/<[^>]*>/g, "").replace(/&(?:nbsp|#160);/g, " ").replace(/&amp;/g, "&").trim());
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((row) => cells(row[0]));
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const freeNames = new Set(rows.filter((row) => row.length >= 3 && row.slice(1, 3).every((cell) => /^(?:free|\$?0(?:\.0+)?)$/i.test(cell)) && row.slice(3).every((cell) => /^(?:free|\$?0(?:\.0+)?|[-–—])$/i.test(cell))).map((row) => normalize(row[0]!)));
  const freeModels = new Map<string, string>();
  const chatModels = new Map<string, string>();
  for (const row of rows) {
    if (row.length !== 4 || !row[0] || !row[1] || !/^[a-zA-Z0-9._-]+$/.test(row[1])) continue;
    if (row[2] !== "https://opencode.ai/inference/openai/v1/chat/completions") continue;
    chatModels.set(row[1], row[0]);
    if (freeNames.has(normalize(row[0]))) freeModels.set(row[1], row[0]);
  }
  if (!rows.length || !rows.some((row) => row[2]?.startsWith("https://opencode.ai/inference/")) || !rows.some((row) => row.length >= 5)) throw new HarnessError("INVALID_PROVIDER_RESPONSE", "OpenCode's current endpoint and pricing tables could not be verified.");
  return { freeModels, chatModels };
}

const OPENCODE_FREE_TIER_RESTRICTION = "Los modelos gratuitos de OpenCode solo pueden usarse en su aplicación. Elige otro proveedor o un modelo local.";
const OPENCODE_FREE_MODELS_CACHE_MS = 60_000;

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
    ...(message.responseState?.reasoningContent ? { reasoning_content: message.responseState.reasoningContent } : {}),
    ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: wireToolName(call.name), arguments: JSON.stringify(call.arguments) } })) } : {}),
  }));
}

function responsesPayload(request: ProviderRequest, toolMap?: ReturnType<typeof mapToolNames>): Record<string, unknown> {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).filter(Boolean).join("\n\n");
  const input: Array<Record<string, unknown>> = [];
  for (const message of request.messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.toolCallId ?? "", output: message.content });
    } else if (message.role === "assistant" && message.responseState?.responses?.length) {
      input.push(...message.responseState.responses);
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      if (message.content) input.push({ role: "assistant", content: message.content });
      for (const call of message.toolCalls) input.push({ type: "function_call", call_id: call.id, name: wireToolName(call.name), arguments: JSON.stringify(call.arguments) });
    } else {
      input.push({ role: message.role, content: message.content });
    }
  }
  return { model: request.model, input, store: false, stream: true,
    max_output_tokens: request.maxOutputTokens ?? 8192,
    ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
    ...(system ? { instructions: system } : {}),
    ...(toolMap ? { tools: toolMap.wire.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false })) } : {}),
  };
}

/** OpenAI's documented open-source Sign in with ChatGPT plan-sharing flow. */
export class ChatGPTPlanProvider implements ProviderAdapter {
  readonly id = "openai_chatgpt";
  readonly label = "ChatGPT plan";
  readonly baseUrl = "https://api.openai.com/v1";
  configured = false;
  private credential?: ChatGPTOAuthCredential;
  private refreshing?: Promise<void>;
  private credentialAbort = new AbortController();

  constructor(private readonly onTokensRotated?: (credential: ChatGPTOAuthCredential) => void) {}

  setOAuthCredential(credential: ChatGPTOAuthCredential | null): void {
    this.credentialAbort.abort(new HarnessError("PROVIDER_AUTH_CHANGED", "The connected ChatGPT account changed."));
    this.credentialAbort = new AbortController();
    this.refreshing = undefined;
    this.credential = credential ?? undefined;
    this.configured = Boolean(credential?.accessToken && credential.refreshToken && credential.clientId && credential.scopes.includes("chatgpt.tokens.use.direct"));
  }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    if (!this.configured) return [];
    signal = AbortSignal.any([discoverySignal(signal), this.credentialAbort.signal]);
    const send = async (refresh = false) => fetch(`${this.baseUrl}/models`, { headers: { authorization: `Bearer ${await this.accessToken(signal, refresh)}`, accept: "application/json" }, signal, redirect: "error" });
    let response = await send();
    if (response.status === 401) { await response.body?.cancel(); response = await send(true); }
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `ChatGPT model discovery failed (${response.status}).`, { providerId: this.id, status: response.status, diagnostics: (await response.text()).slice(0, 2_000) });
    const payload = await response.json() as { models?: Array<{ slug?: string; display_name?: string; visibility?: string }> };
    return (payload.models ?? []).filter((model) => typeof model.slug === "string" && model.visibility === "list").map((model) => ({ id: model.slug!, providerId: this.id, label: model.display_name ?? model.slug!, reasoningEfforts: nativeReasoningEfforts(this.id, model.slug!), capabilities: ["chat", "streaming", "tool-calling"], available: true, priceKind: "subscription" }));
  }

  async complete(request: ProviderRequest): Promise<ProviderTurn> {
    return this.stream(request, () => undefined);
  }

  async stream(request: ProviderRequest, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    if (!this.configured) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Sign in with ChatGPT in Settings to use your ChatGPT plan.");
    validateReasoningEffort(request.reasoningEffort, nativeReasoningEfforts(this.id, request.model), request.model);
    const toolMap = request.tools?.length ? mapToolNames(request.tools) : undefined;
    const payload = responsesPayload(request, toolMap);
    const signal = request.signal ? AbortSignal.any([request.signal, this.credentialAbort.signal]) : this.credentialAbort.signal;
    let token = await this.accessToken(signal);
    let response = await this.send(payload, token, signal);
    if (response.status === 401) {
      await response.body?.cancel();
      token = await this.accessToken(signal, true);
      response = await this.send(payload, token, signal);
    }
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `ChatGPT plan request failed (${response.status}).`, { providerId: this.id, status: response.status, diagnostics: (await response.text()).slice(0, 2_000) });
    if (!response.body) throw new HarnessError("PROVIDER_STREAM_UNAVAILABLE", "ChatGPT returned no response stream.");
    return parseResponsesStream(response.body, onChunk, toolMap?.decode, this.id);
  }

  private async send(payload: Record<string, unknown>, token: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}/responses`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(payload), signal, redirect: "error" });
  }

  private async accessToken(signal?: AbortSignal, forceRefresh = false): Promise<string> {
    if (!this.credential) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Sign in with ChatGPT in Settings to use your ChatGPT plan.");
    if (forceRefresh || this.credential.expiresAt <= Date.now() + 60_000) {
      if (!this.refreshing) {
        // A cancelled inference must not abandon a refresh token already rotated by the server.
        const refresh = this.refreshCredential(this.credentialAbort.signal).finally(() => { if (this.refreshing === refresh) this.refreshing = undefined; });
        this.refreshing = refresh;
      }
      await waitWithAbort(this.refreshing, signal);
    }
    if (!this.credential?.accessToken) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "The ChatGPT account needs to be reconnected in Settings.");
    return this.credential.accessToken;
  }

  private async refreshCredential(signal?: AbortSignal): Promise<void> {
    const current = this.credential;
    if (!current) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "The ChatGPT account needs to be reconnected in Settings.");
    const refreshSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
    const response = await fetch("https://auth.openai.com/api/accounts/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: current.clientId, resource: "https://api.openai.com/v1" }), signal: refreshSignal, redirect: "error" });
    if (!response.ok) throw new HarnessError("PROVIDER_AUTH_EXPIRED", "The ChatGPT account could not refresh its session. Reconnect it in Settings.", { providerId: this.id, status: response.status, diagnostics: (await response.text()).slice(0, 1_000) });
    const tokens = await response.json() as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string };
    if (typeof tokens.access_token !== "string" || !tokens.access_token || typeof tokens.refresh_token !== "string" || !tokens.refresh_token || (tokens.expires_in !== undefined && (!Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0))) throw new HarnessError("INVALID_PROVIDER_RESPONSE", "ChatGPT returned an incomplete token refresh.");
    const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? current.scopes;
    if (!scopes.includes("chatgpt.tokens.use.direct")) throw new HarnessError("PROVIDER_AUTH_EXPIRED", "ChatGPT plan access is no longer authorized. Reconnect the account in Settings.");
    if (this.credential !== current || signal?.aborted) throw new HarnessError("PROVIDER_AUTH_CHANGED", "The connected ChatGPT account changed during refresh.");
    this.credential = { ...current, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000, scopes };
    this.onTokensRotated?.(this.credential);
  }
}

async function parseResponsesStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void, decodeToolName: (name: string) => string = (name) => name, providerId = "openai"): Promise<ProviderTurn> {
  let content = "";
  let completed = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cachedTokens: number | undefined;
  const calls = new Map<number, ProviderToolCall & { rawArguments: string }>();
  const outputItems = new Map<number, Record<string, unknown>>();
  let responseItems: Array<Record<string, unknown>> | undefined;
  await readSse(body, (data, eventType) => {
    if (data === "[DONE]") return;
    const root = parseJsonObject(data);
    eventType ??= typeof root.type === "string" ? root.type : undefined;
    if (eventType === "response.output_text.delta" && typeof root.delta === "string") { content += root.delta; onChunk(root.delta); }
    if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
      const item = root.item && typeof root.item === "object" ? root.item as Record<string, unknown> : {};
      if (eventType === "response.output_item.done") outputItems.set(Number(root.output_index ?? outputItems.size), item);
      if (item.type === "function_call") {
        const index = Number(root.output_index ?? calls.size);
        const current = calls.get(index) ?? { id: String(item.call_id ?? `call_${index}`), name: String(item.name ?? ""), arguments: {}, rawArguments: "" };
        current.id = String(item.call_id ?? current.id);
        current.name = String(item.name ?? current.name);
        if (typeof item.arguments === "string" && (eventType === "response.output_item.done" || !current.rawArguments)) current.rawArguments = item.arguments;
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
      rejectProviderError(response);
      if (Array.isArray(response.output)) responseItems = response.output.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
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
      throw new HarnessError(code.startsWith("subscription_sharing_usage") ? "PROVIDER_USAGE_LIMIT" : "PROVIDER_ERROR", String(error.message ?? `Response failed (${code}).`), { providerId, diagnostics: code });
    }
    if (eventType === "response.incomplete") throw new HarnessError("PROVIDER_INCOMPLETE", "The provider ended the response before completing it.", { providerId });
  });
  if (!completed) throw new HarnessError("PROVIDER_STREAM_INCOMPLETE", "The stream ended without a completed response.", { providerId });
  responseItems ??= [...outputItems.entries()].sort(([left], [right]) => left - right).map(([, item]) => item);
  if (!content) {
    content = responseItems.filter((item) => item.type === "message").flatMap((item) => Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : []).map((part) => typeof part.text === "string" ? part.text : typeof part.refusal === "string" ? part.refusal : "").join("");
    if (content) onChunk(content);
  }
  const finalCalls = responseItems.filter((item) => item.type === "function_call");
  const toolCalls = finalCalls.length ? finalCalls.map((item) => ({ id: String(item.call_id ?? ""), name: decodeToolName(String(item.name ?? "")), arguments: parseToolArguments(item.arguments) })) : [...calls.values()].map((call) => ({ id: call.id, name: decodeToolName(call.name), arguments: parseToolArguments(call.rawArguments || call.arguments) })).filter((call) => call.name);
  return { content, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", ...(responseItems.length ? { responseState: { responses: responseItems } } : {}), ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(cachedTokens === undefined ? {} : { cachedTokens }), costKind: "unknown" };
}

export class OpenAICompatibleProvider implements ProviderAdapter {
  configured: boolean;
  private apiKey?: string;
  private readonly reasoningByModel = new Map<string, string[]>();
  private verifiedOpenCodeFreeModels?: { ids: Set<string>; chatIds: Set<string>; expiresAt: number };

  constructor(
    readonly id: string,
    readonly label: string,
    baseUrl: string,
    apiKey = envKey(id),
    private readonly extraHeaders: Record<string, string> = {},
    private readonly allowUnauthenticated = false,
    private readonly modelsUrl?: string,
    private readonly pricingUrl = "https://dev.opencode.ai/v2/docs/console/models/",
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.configured = Boolean(apiKey) || allowUnauthenticated || id === "ollama" || id === "lmstudio";
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
    // OpenRouter's public catalog still requires its key for inference. OpenCode's models are exposed
    // only after joining its live catalog with the current pricing table below.
    const publicCatalog = this.id === "openrouter" || this.id === "opencode_zen";
    if (!this.configured && !local && !publicCatalog) return [];
    const [response, openCodeModels] = await Promise.all([
      fetch(this.modelsUrl ?? `${this.baseUrl}/models`, { headers: { ...this.headers(), accept: "application/json" }, signal: discoverySignal(signal), redirect: "error" }),
      this.id === "opencode_zen" ? openCodeCatalog(this.pricingUrl, signal) : undefined,
    ]);
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Model discovery failed (${response.status}).`, { providerId: this.id, status: response.status });
    type CatalogModel = { reasoning?: { supported_efforts?: string[] | null; mandatory?: boolean }; id?: string; name?: string; type?: string; capabilities?: { completion_chat?: boolean; function_calling?: boolean }; supported_parameters?: string[]; architecture?: { output_modalities?: string[] }; pricing?: { prompt?: string | number; completion?: string | number } };
    const payload = await response.json() as { data?: CatalogModel[] };
    if (!Array.isArray(payload.data)) throw new HarnessError("INVALID_PROVIDER_RESPONSE", "The model catalog did not contain a models list.");
    const models: ProviderModel[] = payload.data.filter((model): model is CatalogModel & { id: string } => typeof model.id === "string").flatMap((model): ProviderModel[] => {
      if (model.capabilities?.completion_chat === false || (model.type && !["chat", "language", "model"].includes(model.type)) || (model.architecture?.output_modalities && !model.architecture.output_modalities.includes("text"))) return [];
      if (this.id === "openai" && (!/^(?:gpt-|chatgpt-|o\d|codex-)/.test(model.id) || /(?:audio|realtime|transcrib|tts|image|instruct|deep-research|search-preview)/i.test(model.id))) return [];
      if (/(?:^|[\/_-])(?:embed(?:ding)?s?|rerank|whisper|tts|moderation|dall-e)(?:[\/_-]|$)/i.test(model.id)) return [];
      const reasoningEfforts = this.id === "openrouter" ? catalogReasoningEfforts(model.reasoning) : nativeReasoningEfforts(this.id, model.id);
      if (this.id === "opencode_zen") {
        const label = openCodeModels?.chatModels.get(model.id);
        if (!label) return [];
        const free = openCodeModels!.freeModels.has(model.id);
        return [{
          id: model.id, providerId: this.id, label, reasoningEfforts, capabilities: ["chat", "streaming", "tool-calling"], available: !free && Boolean(this.apiKey),
          ...(free ? { availabilityReason: OPENCODE_FREE_TIER_RESTRICTION, priceKind: "free" as const, pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0, updatedAt: new Date().toISOString() } } : { priceKind: "unknown" as const, ...(!this.apiKey ? { availabilityReason: "Conecta tu clave API de OpenCode Console para usar este modelo." } : {}) }),
        }];
      }
      const inputPerMillionUsd = this.id === "openrouter" ? pricePerMillion(model.pricing?.prompt) : undefined;
      const outputPerMillionUsd = this.id === "openrouter" ? pricePerMillion(model.pricing?.completion) : undefined;
      const verifiedPricing = inputPerMillionUsd !== undefined && outputPerMillionUsd !== undefined;
      const localModel = (this.id === "ollama" || this.id === "lmstudio") && isLoopbackEndpoint(this.baseUrl);
      const toolSupport = model.capabilities?.function_calling ?? (model.supported_parameters ? model.supported_parameters.includes("tools") : true);
      return [{
        id: model.id, providerId: this.id, label: model.name ?? model.id, reasoningEfforts, capabilities: ["chat", "streaming", ...(toolSupport ? ["tool-calling"] : [])], available: this.configured || localModel,
        priceKind: localModel ? "local" : verifiedPricing ? (inputPerMillionUsd === 0 && outputPerMillionUsd === 0 ? "free" : "paid") : "unknown",
        ...(verifiedPricing ? { pricing: { inputPerMillionUsd, outputPerMillionUsd, updatedAt: new Date().toISOString() } } : {}),
      }];
    });
    this.reasoningByModel.clear();
    for (const model of models) this.reasoningByModel.set(model.id, model.reasoningEfforts ?? []);
    if (this.id === "opencode_zen") this.verifiedOpenCodeFreeModels = { ids: new Set(openCodeModels?.freeModels.keys()), chatIds: new Set(models.map((model) => model.id)), expiresAt: Date.now() + OPENCODE_FREE_MODELS_CACHE_MS };
    return models;
  }

  private async request(request: ProviderRequest, stream: boolean, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    const local = this.id === "ollama" || this.id === "lmstudio" || this.allowUnauthenticated;
    if (this.id === "opencode_zen") {
      let verified = this.verifiedOpenCodeFreeModels;
      if (!verified || verified.expiresAt <= Date.now()) {
        await this.listModels(request.signal);
        verified = this.verifiedOpenCodeFreeModels;
      }
      if (verified?.ids.has(request.model)) throw new HarnessError("OPENCODE_FREE_TIER_RESTRICTED", OPENCODE_FREE_TIER_RESTRICTION, { providerId: this.id });
      if (!verified?.chatIds.has(request.model)) throw new HarnessError("OPENCODE_MODEL_UNVERIFIED", "This OpenCode model is not currently listed for the supported chat endpoint. Select a model from the current catalog.", { providerId: this.id });
    }
    if (!this.apiKey && !local) throw new HarnessError("PROVIDER_NOT_CONFIGURED", `Provider ${this.id} is not configured. Supply its API key in Settings or via its environment variable.`);
    if (request.reasoningEffort) {
      if (this.id === "openrouter" && !this.reasoningByModel.has(request.model)) await this.listModels(request.signal);
      validateReasoningEffort(request.reasoningEffort, this.reasoningByModel.get(request.model) ?? nativeReasoningEfforts(this.id, request.model), request.model);
    }
    const mappedTools = request.tools?.length ? mapToolNames(request.tools) : undefined;
    const useResponses = this.id === "openai" && !/^(?:gpt-3\.5|gpt-4(?:$|-)|chatgpt-4o)/.test(request.model);
    const payload: Record<string, unknown> = {
      model: request.model,
      ...(this.id === "openai" ? { max_completion_tokens: request.maxOutputTokens ?? 8192 } : { max_tokens: request.maxOutputTokens ?? 8192 }),
      messages: toOpenAIMessages(request.messages),
      ...(request.reasoningEffort ? this.id === "openrouter" ? { reasoning: { effort: request.reasoningEffort }, provider: { require_parameters: true } } : { reasoning_effort: request.reasoningEffort } : {}),
      stream,
      ...(stream && ["openrouter", "openai"].includes(this.id) ? { stream_options: { include_usage: true } } : {}),
      ...(mappedTools ? { tools: mappedTools.wire.map(toOpenAITool) } : {}),
    };
    const response = await fetch(`${this.baseUrl}/${useResponses ? "responses" : "chat/completions"}`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(useResponses ? responsesPayload(request, mappedTools) : payload),
      signal: request.signal,
      redirect: "error",
    });
    if (!response.ok) {
      const diagnostics = (await response.text()).slice(0, 2_000);
      throw new HarnessError("PROVIDER_ERROR", `Provider request failed (${response.status}).`, { providerId: this.id, status: response.status, diagnostics });
    }
    if (!stream && !useResponses) return parseCompletion(await response.json(), mappedTools?.decode, this.id === "openrouter");
    if (!response.body) throw new HarnessError("PROVIDER_STREAM_UNAVAILABLE", "Provider returned no response body for a streaming request.");
    if (useResponses) return parseResponsesStream(response.body, onChunk, mappedTools?.decode, this.id);
    return parseSseStream(response.body, onChunk, mappedTools?.decode, this.id === "openrouter");
  }

  private headers(): Record<string, string> {
    return { ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}), accept: "text/event-stream", ...this.extraHeaders };
  }

  setCredential(key: string | undefined): void { this.apiKey = key; this.configured = Boolean(key) || this.allowUnauthenticated || this.id === "ollama" || this.id === "lmstudio"; }
}

/** SuperGrok plan access through xAI's OAuth device flow. API-key billing remains a separate provider. */
export class XaiPlanProvider extends OpenAICompatibleProvider {
  private credential?: XaiOAuthCredential;
  private refreshing?: Promise<void>;
  private credentialGeneration = 0;

  constructor(private readonly onTokensRotated?: (credential: XaiOAuthCredential) => void) {
    super("xai_plan", "SuperGrok", "https://api.x.ai/v1", "", { "User-Agent": "OrderCode" });
  }

  setCredential(key: string | undefined): void {
    if (key) throw new HarnessError("PROVIDER_CREDENTIAL_UNSUPPORTED", "SuperGrok uses the account connection. Add API keys in the separate xAI provider settings.");
    this.setOAuthCredential(null);
  }

  setOAuthCredential(credential: XaiOAuthCredential | null): void {
    this.credentialGeneration += 1;
    this.credential = credential ?? undefined;
    this.refreshing = undefined;
    super.setCredential(credential?.accessToken);
  }

  async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    if (!this.credential) return [];
    await this.ensureAccessToken(false, signal);
    try { return (await super.listModels(signal)).map((model) => ({ ...model, priceKind: "subscription", pricing: undefined })); }
    catch (error) {
      if (!this.isUnauthorized(error)) throw error;
      await this.ensureAccessToken(true, signal);
      return (await super.listModels(signal)).map((model) => ({ ...model, priceKind: "subscription", pricing: undefined }));
    }
  }

  async complete(request: ProviderRequest): Promise<ProviderTurn> {
    await this.ensureAccessToken(false, request.signal);
    try { return await super.complete(request); }
    catch (error) {
      if (!this.isUnauthorized(error)) throw error;
      await this.ensureAccessToken(true, request.signal);
      return super.complete(request);
    }
  }

  async stream(request: ProviderRequest, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    await this.ensureAccessToken(false, request.signal);
    try { return await super.stream(request, onChunk); }
    catch (error) {
      if (!this.isUnauthorized(error)) throw error;
      await this.ensureAccessToken(true, request.signal);
      return super.stream(request, onChunk);
    }
  }

  private isUnauthorized(error: unknown): boolean {
    return error instanceof HarnessError && error.details?.providerId === this.id && error.details.status === 401;
  }

  private async ensureAccessToken(force: boolean, signal?: AbortSignal): Promise<void> {
    const current = this.credential;
    if (!current) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Connect a SuperGrok account in Settings to use models from your xAI plan.");
    if (!force && current.expiresAt > Date.now() + 60_000) return;
    const generation = this.credentialGeneration;
    if (!this.refreshing) {
      const refresh = async () => {
        const response = await fetch("https://auth.x.ai/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: "b1a00492-073a-47ea-816f-4c329264a828" }),
          signal,
          redirect: "error",
        });
        if (!response.ok) throw new HarnessError("PROVIDER_AUTH_EXPIRED", `xAI OAuth refresh failed (${response.status}). Reconnect your SuperGrok account in Settings.`, { providerId: this.id, status: response.status });
        const result = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
        if (this.credentialGeneration !== generation || this.credential?.connectionId !== current.connectionId) throw new HarnessError("PROVIDER_AUTH_CHANGED", "The connected SuperGrok account changed during token refresh.");
        if (typeof result.access_token !== "string" || !result.access_token || typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
          throw new HarnessError("INVALID_PROVIDER_RESPONSE", "xAI returned invalid OAuth credentials.", { providerId: this.id });
        }
        const next: XaiOAuthCredential = {
          ...current,
          accessToken: result.access_token,
          refreshToken: typeof result.refresh_token === "string" && result.refresh_token ? result.refresh_token : current.refreshToken,
          expiresAt: Date.now() + result.expires_in * 1_000,
        };
        this.credential = next;
        super.setCredential(next.accessToken);
        this.onTokensRotated?.(next);
      };
      const pending = refresh().finally(() => { if (this.refreshing === pending) this.refreshing = undefined; });
      this.refreshing = pending;
    }
    await this.refreshing;
  }
}

function toOpenAITool(definition: ToolDefinition): Record<string, unknown> {
  return { type: "function", function: { name: definition.name, description: definition.description, parameters: definition.inputSchema } };
}

function parseCompletion(payload: unknown, decodeToolName: (name: string) => string = (name) => name, includeCost = false): ProviderTurn {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  rejectProviderError(root);
  const choice = Array.isArray(root.choices) ? root.choices[0] as Record<string, unknown> | undefined : undefined;
  if (!choice || !choice.message) throw new HarnessError("INVALID_PROVIDER_RESPONSE", "The provider returned no completion.");
  const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.map((call) => {
    const record = call as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object" ? record.function as Record<string, unknown> : {};
    return { id: String(record.id ?? `call_${Math.random().toString(36).slice(2)}`), name: decodeToolName(String(fn.name ?? "")), arguments: parseToolArguments(fn.arguments) } satisfies ProviderToolCall;
  }).filter((call) => call.name) : [];
  const usage = root.usage && typeof root.usage === "object" ? root.usage as Record<string, unknown> : {};
  const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" ? usage.prompt_tokens_details as Record<string, unknown> : {};
  const costUsd = includeCost && typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : undefined;
  return { content: typeof message.content === "string" ? message.content : "", toolCalls, finishReason: String(choice?.finish_reason ?? "stop"), ...(typeof message.reasoning_content === "string" ? { responseState: { reasoningContent: message.reasoning_content } } : {}), ...(typeof usage.prompt_tokens === "number" ? { inputTokens: usage.prompt_tokens } : {}), ...(typeof usage.completion_tokens === "number" ? { outputTokens: usage.completion_tokens } : {}), ...(typeof promptDetails.cached_tokens === "number" ? { cachedTokens: promptDetails.cached_tokens } : {}), ...(costUsd === undefined ? {} : { costUsd, costKind: "exact" as const }), raw: payload };
}

async function parseSseStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void, decodeToolName: (name: string) => string = (name) => name, includeCost = false): Promise<ProviderTurn> {
  let content = "";
  let finishReason = "stop";
  let completed = false;
  let reasoningContent = "";
  const calls = new Map<number, ProviderToolCall>();
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cachedTokens: number | undefined;
  let costUsd: number | undefined;
  await readSse(body, (data): void => {
    if (data === "[DONE]") { completed = true; return; }
    const root = parseJsonObject(data);
    rejectProviderError(root);
    const choice = Array.isArray(root.choices) ? root.choices[0] as Record<string, unknown> | undefined : undefined;
    const delta = choice?.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
    if (typeof delta.content === "string") { content += delta.content; onChunk(delta.content); }
    if (typeof delta.reasoning_content === "string") reasoningContent += delta.reasoning_content;
    if (typeof choice?.finish_reason === "string") { finishReason = choice.finish_reason; completed = true; }
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
  });
  if (!completed) throw new HarnessError("PROVIDER_STREAM_INCOMPLETE", "The provider stream ended before a completion marker.");
  const toolCalls = [...calls.values()].map((call) => {
    const rawArguments = (call as ProviderToolCall & { rawArguments?: string }).rawArguments;
    if (rawArguments !== undefined) call.arguments = parseToolArguments(rawArguments);
    call.name = decodeToolName(call.name);
    return call;
  }).filter((call) => call.name);
  return { content, toolCalls, finishReason, ...(reasoningContent ? { responseState: { reasoningContent } } : {}), ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(cachedTokens === undefined ? {} : { cachedTokens }), ...(costUsd === undefined ? {} : { costUsd, costKind: "exact" as const }) };
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
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/models?limit=100`, { headers: { ...this.headers(), accept: "application/json" }, signal: discoverySignal(signal), redirect: "error" });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Anthropic model discovery failed (${response.status}).`);
    const data = await response.json() as { data?: Array<{ id?: string; display_name?: string }> };
    return (data.data ?? []).filter((model): model is { id: string; display_name?: string } => typeof model.id === "string").map((model) => ({ id: model.id, providerId: this.id, label: model.display_name ?? model.id, reasoningEfforts: nativeReasoningEfforts(this.id, model.id), capabilities: ["chat", "streaming", "tool-calling"], available: true, priceKind: "unknown" }));
  }

  private async request(request: ProviderRequest, streaming: boolean, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    if (!this.apiKey) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Anthropic API credentials are not configured.");
    validateReasoningEffort(request.reasoningEffort, nativeReasoningEfforts(this.id, request.model), request.model);
    const mapped = request.tools?.length ? mapToolNames(request.tools) : undefined;
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [];
    for (const message of request.messages.filter((message) => message.role !== "system")) {
      if (message.role === "tool") {
        const part = { type: "tool_result", tool_use_id: message.toolCallId, content: message.content };
        const previous = messages.at(-1);
        if (previous?.role === "user" && Array.isArray(previous.content) && previous.content.every((item) => item.type === "tool_result")) previous.content.push(part);
        else messages.push({ role: "user", content: [part] });
        continue;
      }
      if (message.role === "assistant" && message.responseState?.anthropicBlocks?.length) { messages.push({ role: "assistant", content: message.responseState.anthropicBlocks }); continue; }
      if (message.role === "assistant" && message.toolCalls?.length) messages.push({ role: "assistant", content: [...(message.content ? [{ type: "text", text: message.content }] : []), ...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: wireToolName(call.name), input: call.arguments }))] });
      else messages.push({ role: message.role === "assistant" ? "assistant" : "user", content: message.content });
    }
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST", headers: { ...this.headers(), "content-type": "application/json" }, signal: request.signal, redirect: "error",
      body: JSON.stringify({ model: request.model, max_tokens: request.maxOutputTokens ?? 8192, ...(request.reasoningEffort ? { output_config: { effort: request.reasoningEffort } } : {}), messages, ...(system ? { system } : {}), ...(streaming ? { stream: true } : {}), ...(mapped ? { tools: mapped.wire.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) } : {}) }),
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
  rejectProviderError(root);
  if (!Array.isArray(root.content)) throw new HarnessError("INVALID_PROVIDER_RESPONSE", "Anthropic returned no content blocks.");
  const blocks = root.content as Array<Record<string, unknown>>;
  const usage = root.usage && typeof root.usage === "object" ? root.usage as Record<string, unknown> : {};
  const cachedTokens = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined;
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens + (cachedTokens ?? 0) + (typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0) : undefined;
  return {
    content: blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text as string).join(""),
    toolCalls: blocks.filter((block) => block.type === "tool_use" && typeof block.name === "string").map((block) => ({ id: String(block.id), name: decode(String(block.name)), arguments: parseToolArguments(block.input) })),
    finishReason: String(root.stop_reason ?? "stop"), responseState: { anthropicBlocks: blocks },
    ...(inputTokens === undefined ? {} : { inputTokens }), ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}), ...(cachedTokens === undefined ? {} : { cachedTokens }),
  };
}

async function parseAnthropicStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void, decode: (name: string) => string = (name) => name): Promise<ProviderTurn> {
  const blocks = new Map<number, Record<string, unknown>>();
  const argumentsByIndex = new Map<number, string>();
  let usage: Record<string, unknown> = {};
  let stopReason = "stop";
  let completed = false;
  await readSse(body, (data, event) => {
    const root = parseJsonObject(data);
    rejectProviderError(root);
    event ??= typeof root.type === "string" ? root.type : undefined;
    const index = Number(root.index ?? 0);
    if (event === "message_start") {
      const message = root.message as Record<string, unknown> | undefined;
      if (message?.usage && typeof message.usage === "object") usage = { ...usage, ...message.usage };
    }
    if (event === "content_block_start") {
      const block = root.content_block as Record<string, unknown> | undefined;
      if (block) {
        blocks.set(index, { ...block });
        if (block.type === "text" && typeof block.text === "string" && block.text) onChunk(block.text);
      }
    }
    if (event === "content_block_delta") {
      const delta = root.delta as Record<string, unknown> | undefined;
      const block = blocks.get(index);
      if (block && delta) {
        if (delta.type === "text_delta" && typeof delta.text === "string") { block.text = String(block.text ?? "") + delta.text; onChunk(delta.text); }
        if (delta.type === "thinking_delta" && typeof delta.thinking === "string") block.thinking = String(block.thinking ?? "") + delta.thinking;
        if (delta.type === "signature_delta" && typeof delta.signature === "string") block.signature = String(block.signature ?? "") + delta.signature;
        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") argumentsByIndex.set(index, (argumentsByIndex.get(index) ?? "") + delta.partial_json);
      }
    }
    if (event === "message_delta") {
      const delta = root.delta as Record<string, unknown> | undefined;
      if (typeof delta?.stop_reason === "string") stopReason = delta.stop_reason;
      if (root.usage && typeof root.usage === "object") usage = { ...usage, ...root.usage };
    }
    if (event === "message_stop") completed = true;
  });
  if (!completed) throw new HarnessError("PROVIDER_STREAM_INCOMPLETE", "Anthropic's stream ended before message_stop.");
  for (const [index, raw] of argumentsByIndex) { const block = blocks.get(index); if (block) block.input = parseToolArguments(raw); }
  return parseAnthropicTurn({ content: [...blocks.entries()].sort(([left], [right]) => left - right).map(([, block]) => block), stop_reason: stopReason, usage }, decode);
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
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/models?pageSize=1000`, { headers: { "x-goog-api-key": this.apiKey }, signal: discoverySignal(signal), redirect: "error" });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Gemini model discovery failed (${response.status}).`);
    const data = await response.json() as { models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }> };
    return (data.models ?? []).filter((model) => typeof model.name === "string" && (model.supportedGenerationMethods ?? []).includes("generateContent")).map((model) => ({ id: model.name!.replace(/^models\//, ""), providerId: this.id, label: model.displayName ?? model.name!, reasoningEfforts: nativeReasoningEfforts(this.id, model.name!.replace(/^models\//, "")), capabilities: model.supportedGenerationMethods ?? [], available: true, priceKind: "unknown" }));
  }
  private async request(request: ProviderRequest, streaming: boolean, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
    if (!this.apiKey) throw new HarnessError("PROVIDER_NOT_CONFIGURED", "Google Gemini API credentials are not configured.");
    validateReasoningEffort(request.reasoningEffort, nativeReasoningEfforts(this.id, request.model), request.model);
    const tools = request.tools?.length ? mapToolNames(request.tools) : undefined;
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
    for (const message of request.messages.filter((message) => message.role !== "system")) {
      if (message.role === "tool") {
        const part = { functionResponse: { name: wireToolName(message.toolName ?? "tool"), ...(message.toolCallId && !message.toolCallId.startsWith("gemini_") ? { id: message.toolCallId } : {}), response: { result: message.content } } };
        const previous = contents.at(-1);
        if (previous?.role === "user" && previous.parts.every((item) => item.functionResponse)) previous.parts.push(part);
        else contents.push({ role: "user", parts: [part] });
        continue;
      }
      if (message.role === "assistant" && message.responseState?.geminiParts?.length) { contents.push({ role: "model", parts: message.responseState.geminiParts }); continue; }
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) parts.push({ text: message.content });
      if (message.role === "assistant") for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: wireToolName(call.name), args: call.arguments } });
      contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
    }
    const method = streaming ? "streamGenerateContent?alt=sse" : "generateContent";
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(request.model)}:${method}`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: request.maxOutputTokens ?? 8192, ...(request.reasoningEffort ? { thinkingConfig: { thinkingLevel: request.reasoningEffort } } : {}) }, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), ...(tools ? { tools: [{ functionDeclarations: tools.wire.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }] } : {}) }), signal: request.signal, redirect: "error" });
    if (!response.ok) throw new HarnessError("PROVIDER_ERROR", `Gemini request failed (${response.status}).`, { diagnostics: (await response.text()).slice(0, 2_000) });
    if (!streaming) return parseGeminiTurn(await response.json(), tools?.decode);
    if (!response.body) throw new HarnessError("PROVIDER_STREAM_UNAVAILABLE", "Gemini returned no streaming response body.");
    return parseGeminiStream(response.body, onChunk, tools?.decode);
  }

  setCredential(key: string | undefined): void { this.apiKey = key; this.configured = Boolean(key); }
}

function parseGeminiTurn(value: unknown, decode: (name: string) => string = (name) => name): ProviderTurn {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  rejectProviderError(root);
  const candidates = Array.isArray(root.candidates) ? root.candidates as Array<Record<string, unknown>> : [];
  const candidate = candidates[0];
  const content = candidate?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : [];
  const usage = root.usageMetadata as Record<string, unknown> | undefined;
  const feedback = root.promptFeedback as Record<string, unknown> | undefined;
  if (!candidate && !usage && !feedback) throw new HarnessError("INVALID_PROVIDER_RESPONSE", "Gemini returned no candidates or usage.");
  const calls = parts.filter((part) => part.functionCall && typeof part.functionCall === "object").map((part) => {
    const call = part.functionCall as Record<string, unknown>;
    return { id: typeof call.id === "string" ? call.id : "gemini_" + randomUUID(), name: decode(String(call.name ?? "")), arguments: parseToolArguments(call.args) };
  }).filter((call) => call.name);
  const outputTokens = typeof usage?.candidatesTokenCount === "number" || typeof usage?.thoughtsTokenCount === "number" ? Number(usage.candidatesTokenCount ?? 0) + Number(usage.thoughtsTokenCount ?? 0) : undefined;
  return {
    content: parts.filter((part) => part.thought !== true && typeof part.text === "string").map((part) => part.text as string).join(""),
    toolCalls: calls, finishReason: String(candidate?.finishReason ?? feedback?.blockReason ?? ""),
    ...(parts.length ? { responseState: { geminiParts: parts } } : {}),
    ...(typeof usage?.promptTokenCount === "number" ? { inputTokens: usage.promptTokenCount } : {}), ...(outputTokens === undefined ? {} : { outputTokens }), ...(typeof usage?.cachedContentTokenCount === "number" ? { cachedTokens: usage.cachedContentTokenCount } : {}),
  };
}

async function parseGeminiStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void, decode?: (name: string) => string): Promise<ProviderTurn> {
  let content = "";
  let finishReason = "";
  const calls: ProviderToolCall[] = [];
  const parts: Array<Record<string, unknown>> = [];
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cachedTokens: number | undefined;
  await readSse(body, (data) => {
    const turn = parseGeminiTurn(parseJsonObject(data), decode);
    if (turn.content) { content += turn.content; onChunk(turn.content); }
    if (turn.finishReason) finishReason = turn.finishReason;
    calls.push(...turn.toolCalls);
    parts.push(...turn.responseState?.geminiParts ?? []);
    if (turn.inputTokens !== undefined) inputTokens = turn.inputTokens;
    if (turn.outputTokens !== undefined) outputTokens = turn.outputTokens;
    if (turn.cachedTokens !== undefined) cachedTokens = turn.cachedTokens;
  });
  if (!finishReason) throw new HarnessError("PROVIDER_STREAM_INCOMPLETE", "Gemini's stream ended without a finish reason.");
  return { content, toolCalls: calls, finishReason, ...(parts.length ? { responseState: { geminiParts: parts } } : {}), ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(cachedTokens === undefined ? {} : { cachedTokens }) };
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(options: ProviderRegistryOptions = {}) {
    const configured = options.adapters ?? defaultAdapters(options.onOAuthTokensRotated, options.onXaiOAuthTokensRotated);
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
  setOAuthCredential(id: string, credential: ChatGPTOAuthCredential | XaiOAuthCredential | null): void {
    if (id === "xai_plan") {
      const adapter = this.adapters.get(id);
      if (!(adapter instanceof XaiPlanProvider)) throw new HarnessError("PROVIDER_NOT_FOUND", `Provider not found: ${id}`);
      if (credential && (!("connectionId" in credential) || ![credential.accessToken, credential.refreshToken, credential.connectionId].every((value) => typeof value === "string" && value.length > 0) || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= 0)) {
        throw new HarnessError("INVALID_PROVIDER_CREDENTIAL", "A valid SuperGrok account credential is required.");
      }
      adapter.setOAuthCredential(credential as XaiOAuthCredential | null);
      return;
    }
    if (id !== "openai_chatgpt") throw new HarnessError("PROVIDER_AUTH_UNSUPPORTED", `Provider ${id} does not support account authorization.`);
    const adapter = this.adapters.get(id);
    if (!(adapter instanceof ChatGPTPlanProvider)) throw new HarnessError("PROVIDER_NOT_FOUND", `Provider not found: ${id}`);
    if (credential && !("idToken" in credential)) throw new HarnessError("INVALID_PROVIDER_CREDENTIAL", "A valid ChatGPT plan credential is required.");
    const chatGPTCredential = credential as ChatGPTOAuthCredential | null;
    if (chatGPTCredential && (![chatGPTCredential.accessToken, chatGPTCredential.refreshToken, chatGPTCredential.idToken, chatGPTCredential.clientId, chatGPTCredential.subject, chatGPTCredential.hostId].every((value) => typeof value === "string" && value.length > 0) || !Number.isFinite(chatGPTCredential.expiresAt) || chatGPTCredential.expiresAt <= 0 || !Array.isArray(chatGPTCredential.scopes) || chatGPTCredential.scopes.some((scope) => typeof scope !== "string") || !chatGPTCredential.scopes.includes("chatgpt.tokens.use.direct"))) {
      throw new HarnessError("INVALID_PROVIDER_CREDENTIAL", "A valid ChatGPT plan credential is required.");
    }
    adapter.setOAuthCredential(chatGPTCredential);
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

function defaultAdapters(onOAuthTokensRotated?: (credential: ChatGPTOAuthCredential) => void, onXaiOAuthTokensRotated?: (credential: XaiOAuthCredential) => void): ProviderAdapter[] {
  return [
    new OpenAICompatibleProvider("openai", "OpenAI", process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"),
    new ChatGPTPlanProvider(onOAuthTokensRotated),
    new XaiPlanProvider(onXaiOAuthTokensRotated),
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
  for (const name of ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "OPENCODE_ZEN_API_KEY", "OPENCODE_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "FIREWORKS_API_KEY", "CEREBRAS_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "XAI_PLAN_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OLLAMA_API_KEY", "LMSTUDIO_API_KEY"]) delete process.env[name];
}

