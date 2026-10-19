import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ChatGPTPlanProvider, OpenAICompatibleProvider, ProviderRegistry, XaiPlanProvider, MiniMaxPlanProvider, type ChatGPTOAuthCredential } from "./providers.js";
import type { ProviderRequest, ToolDefinition } from "./types.js";

const request = (model = "fixture-model"): ProviderRequest => ({ model, messages: [{ role: "system", content: "Use tools accurately." }, { role: "user", content: "Inspect the project." }] });
const tool = (name: string): ToolDefinition => ({ name, description: "Read a project file", effects: ["READ"], cancellable: true, inputSchema: { type: "object", properties: {} } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const openRouterChatModel = (id: string, extra: Record<string, unknown> = {}) => ({ id, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools"], ...extra });
const event = (value: unknown, type?: string) => `${type ? `event: ${type}\r\n` : ""}data: ${typeof value === "string" ? value : JSON.stringify(value)}\r\n\r\n`;
function stream(frames: string[], chunkSize = 7, close = true, cancelled?: () => void): Response {
  const bytes = new TextEncoder().encode(frames.join(""));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (let index = 0; index < bytes.length; index += chunkSize) controller.enqueue(bytes.slice(index, index + chunkSize)); if (close) controller.close(); },
    cancel() { cancelled?.(); },
  }), { headers: { "content-type": "text/event-stream" } });
}
function fetchFixture(t: TestContext, handle: (url: URL, init: RequestInit) => Response | Promise<Response>): void {
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init: RequestInit = {}) => Promise.resolve(handle(new URL(typeof input === "string" || input instanceof URL ? input : input.url), init)));
}
const credential = (suffix = "one", expiresAt = Date.now() + 3_600_000): ChatGPTOAuthCredential => ({ accessToken: `fixture-access-${suffix}`, refreshToken: `fixture-refresh-${suffix}`, idToken: `fixture-id-${suffix}`, clientId: "fixture-client", subject: suffix, hostId: "fixture-host", expiresAt, scopes: ["chatgpt.tokens.use.direct"] });
const catalog = { models: [{ slug: "model-b", display_name: "B", visibility: "list" }, { slug: "hidden", visibility: "hidden" }, { slug: "model-a", display_name: "A", visibility: "list" }] };
const completed = (output: unknown[] = [], usage = { input_tokens: 4, output_tokens: 2 }) => event({ type: "response.completed", response: { output, usage } });

test("local providers work without API keys and discovery keeps free pricing explicit", async (t) => {
  fetchFixture(t, (_url, init) => { assert.ok(init.signal); assert.equal(new Headers(init.headers).get("accept"), "application/json"); return json({ data: [{ id: "local-chat" }] }); });
  for (const id of ["ollama", "lmstudio"]) {
    const adapter = new OpenAICompatibleProvider(id, id, "http://127.0.0.1:1234/v1", "");
    assert.equal(adapter.configured, true);
    adapter.setCredential(undefined);
    assert.equal(adapter.configured, true);
    assert.equal((await adapter.listModels())[0]?.priceKind, "local");
  }
  const localCustom = new ProviderRegistry().registerCustomEndpoint({ id: "custom_fixturelocal", label: "Local", baseUrl: "http://127.0.0.1:1234/v1" });
  // A loopback URL can proxy a paid cloud API; custom endpoints must remain unpriced.
  assert.equal((await localCustom.listModels())[0]?.priceKind, "unknown");
});

test("model discovery excludes incompatible models and does not invent tool capabilities", async (t) => {
  fetchFixture(t, () => json({ data: [{ id: "gpt-4.1" }, { id: "text-embedding-3-small" }, { id: "gpt-image-1" }, { id: "gpt-4o-transcribe" }, { id: "gpt-3.5-turbo-instruct" }, { id: "o3" }] }));
  const openai = new OpenAICompatibleProvider("openai", "OpenAI", "https://api.openai.com/v1", "fixture");
  assert.deepEqual((await openai.listModels()).map((model) => model.id), ["gpt-4.1", "o3"]);
  fetchFixture(t, () => json({ data: [openRouterChatModel("text-only", { supported_parameters: [], pricing: { prompt: "0", completion: "0" } }), openRouterChatModel("audio-output", { architecture: { input_modalities: ["text"], output_modalities: ["text", "audio"] } }), { id: "video-only", architecture: { input_modalities: ["text"], output_modalities: ["video"] }, supported_parameters: ["tools"] }, { id: "embedding-only", architecture: { output_modalities: ["image"] } }] }));
  const models = await new OpenAICompatibleProvider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "fixture").listModels();
  assert.deepEqual(models.map((model) => model.id), ["openrouter/free"]);
});

test("OpenRouter puts the zero-cost free router in the catalog and sends it only through the keyed provider", async (t) => {
  let requestSeen = false;
  fetchFixture(t, (url, init) => {
    if (url.pathname.endsWith("/models")) {
      assert.equal(url.searchParams.get("output_modalities"), "text");
      assert.equal(url.searchParams.get("sort"), "coding-high-to-low");
      assert.equal(url.searchParams.get("limit"), "1000");
      return json({ data: [openRouterChatModel("nvidia/example:free", { name: "Example Free", pricing: { prompt: "0", completion: "0" } })] });
    }
    requestSeen = true;
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-openrouter-key");
    assert.equal(JSON.parse(String(init.body)).model, "openrouter/free");
    return json({ choices: [{ message: { content: "Free route ready." }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
  });
  const router = new OpenAICompatibleProvider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "");
  const unavailable = await router.listModels();
  const freeRouter = unavailable.find((model) => model.id === "openrouter/free");
  assert.equal(freeRouter?.priceKind, "free");
  assert.equal(freeRouter?.available, false);
  assert.match(freeRouter?.availabilityReason ?? "", /clave gratuita/);
  assert.equal(unavailable.find((model) => model.id === "nvidia/example:free")?.priceKind, "free");
  router.setCredential("fixture-openrouter-key");
  assert.equal((await router.listModels()).find((model) => model.id === "openrouter/free")?.available, true);
  assert.equal((await router.complete(request("openrouter/free"))).content, "Free route ready.");
  assert.equal(requestSeen, true);
});

test("OpenRouter verifies its official free router even if the public catalog omits price metadata", async (t) => {
  fetchFixture(t, () => json({ data: [openRouterChatModel("openrouter/free", { name: "Free Models Router" })] }));
  const router = new OpenAICompatibleProvider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "fixture-key");
  const free = (await router.listModels()).find((model) => model.id === "openrouter/free");
  assert.equal(free?.priceKind, "free");
  assert.equal(free?.pricing?.inputPerMillionUsd, 0);
  assert.equal(free?.pricing?.outputPerMillionUsd, 0);
  assert.equal(free?.available, true);
});

test("OpenRouter reports free-model quota failures in a way the user can act on", async (t) => {
  fetchFixture(t, () => new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429, headers: { "retry-after": "30" } }));
  const router = new OpenAICompatibleProvider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "fixture-key");
  await assert.rejects(router.complete(request("nvidia/example:free")), (error: unknown) => error instanceof Error && error.message.includes("limitó temporalmente") && "details" in error && (error as { details?: { retryAfter?: string } }).details?.retryAfter === "30");
});

test("SuperGrok uses the official Grok Build proxy and its subscription stream contract", async (t) => {
  fetchFixture(t, (url, init) => {
    assert.equal(url.origin, "https://cli-chat-proxy.grok.com");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), "Bearer fixture-grok-session");
    assert.equal(headers.get("x-xai-token-auth"), "xai-grok-cli");
    assert.equal(headers.get("x-authenticateresponse"), "authenticate-response");
    assert.equal(headers.get("x-grok-client-version"), "1.0.46");
    assert.equal(headers.get("x-grok-client-identifier"), "ordercode");
    assert.equal(headers.get("x-grok-client-mode"), "interactive");
    if (url.pathname.endsWith("/models")) return json({ data: [{ id: "grok-build", name: "Grok Build" }] });
    assert.equal(url.pathname, "/v1/chat/completions");
    assert.equal(headers.get("x-grok-model-override"), "grok-build");
    assert.equal(headers.get("x-grok-conv-id"), "fixture-session-id");
    assert.equal(headers.get("x-grok-session-id"), "fixture-session-id");
    assert.match(headers.get("x-grok-req-id") ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(JSON.parse(String(init.body)).model, "grok-build");
    assert.equal(JSON.parse(String(init.body)).stream, true);
    return stream([event({ choices: [{ delta: { content: "Grok plan is connected." } }] }), event({ choices: [{ delta: {}, finish_reason: "stop" }] }), event("[DONE]")]);
  });
  const provider = new XaiPlanProvider();
  provider.setOAuthCredential({ accessToken: "fixture-grok-session", refreshToken: "fixture-refresh", expiresAt: Date.now() + 3_600_000, connectionId: "fixture-account" });
  const [model] = await provider.listModels();
  assert.equal(model?.id, "grok-build");
  assert.equal(model?.priceKind, "subscription");
  assert.equal(model?.available, true);
  assert.equal((await provider.complete({ ...request("grok-build"), sessionId: "fixture-session-id" })).content, "Grok plan is connected.");
});

test("SuperGrok makes HTTP 426 actionable without treating OAuth as a failed login", async (t) => {
  fetchFixture(t, () => new Response("client update required", { status: 426 }));
  const provider = new XaiPlanProvider();
  provider.setOAuthCredential({ accessToken: "fixture-grok-session", refreshToken: "fixture-refresh", expiresAt: Date.now() + 3_600_000, connectionId: "fixture-account" });
  await assert.rejects(provider.complete(request("grok-build")), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "PROVIDER_PROTOCOL_UPGRADE_REQUIRED");
    assert.match((error as Error).message, /HTTP 426/);
    assert.match((error as Error).message, /volver a conectar la cuenta no soluciona/);
    assert.equal((error as { details?: { providerId?: string } }).details?.providerId, "xai_plan");
    return true;
  });
});

test("OpenCode blocks its restricted free tier before inference with or without credentials and revalidates the catalog", async (t) => {
  let paid = false;
  let broken = false;
  let clock = Date.now();
  let inferenceCalls = 0;
  t.mock.method(Date, "now", () => clock);
  fetchFixture(t, (url, init) => {
    if (url.pathname === "/pricing") {
      assert.equal(new Headers(init.headers).get("authorization"), null);
      return new Response(broken ? "<html>Sign in</html>" : `<table>
        <tr><td>Future Free</td><td>new-model-free</td><td><code>https://opencode.ai/inference/openai/v1/chat/completions</code></td><td>compatible</td></tr>
        <tr><td>Future Free</td><td>${paid ? "$0.10" : "Free"}</td><td>Free</td><td>Free</td><td>-</td></tr>
        <tr><td>Paid Chat</td><td>paid-chat</td><td>https://opencode.ai/inference/openai/v1/chat/completions</td><td>compatible</td></tr>
        <tr><td>Paid Chat</td><td>$1.00</td><td>$2.00</td><td>-</td><td>-</td></tr>
        <tr><td>Other Free</td><td>other-free</td><td>https://opencode.ai/inference/systemone/v1/systemone</td><td>-</td></tr>
        <tr><td>Other Free</td><td>Free</td><td>Free</td><td>-</td><td>-</td></tr>
        </table>`);
    }
    if (init.method === "POST") {
      inferenceCalls++;
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-secret");
      assert.equal(JSON.parse(String(init.body)).model, "paid-chat");
      return json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    }
    return json({ data: [{ id: "new-model-free" }, { id: "paid-chat" }, { id: "other-free" }, { id: "unverified-free" }] });
  });
  const adapter = new OpenAICompatibleProvider("opencode_zen", "OpenCode", "https://fixture.invalid/v1", "", {}, false, "https://fixture.invalid/models", "https://fixture.invalid/pricing");
  assert.equal(adapter.configured, false);
  const models = await adapter.listModels();
  assert.deepEqual(models.map((model) => model.id), ["new-model-free", "paid-chat"]);
  assert.equal(models[0]?.pricing?.inputPerMillionUsd, 0);
  assert.equal(models[0]?.available, false);
  assert.match(models[0]?.availabilityReason ?? "", /OpenCode/);
  assert.equal(models[1]?.priceKind, "unknown");
  assert.equal(models[1]?.available, false);
  const restricted = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "OPENCODE_FREE_TIER_RESTRICTED";
  await assert.rejects(adapter.complete(request("new-model-free")), restricted);
  await assert.rejects(adapter.complete(request("paid-chat")), /not configured/);
  adapter.setCredential("fixture-secret");
  assert.equal(adapter.configured, true);
  assert.equal((await adapter.listModels())[0]?.available, false);
  assert.equal((await adapter.listModels())[1]?.available, true);
  await assert.rejects(adapter.complete(request("new-model-free")), restricted);
  await assert.rejects(adapter.complete(request("unverified-free")), /not currently listed/);
  assert.equal(inferenceCalls, 0);
  await adapter.complete(request("paid-chat"));
  assert.equal(inferenceCalls, 1);
  paid = true;
  const changed = await adapter.listModels();
  assert.equal(changed[0]?.priceKind, "unknown");
  assert.equal(changed[0]?.available, true);
  // An expired cache must notice a paid model becoming restricted before the next POST.
  paid = false; clock += 60_001;
  await assert.rejects(adapter.complete(request("new-model-free")), restricted);
  assert.equal(inferenceCalls, 1);
  adapter.setCredential(undefined);
  assert.equal(adapter.configured, false);
  broken = true;
  await assert.rejects(adapter.listModels(), /could not be verified/);
});

test("compatible SSE handles UTF-8, CRLF, final usage and reasoning continuity", async (t) => {
  fetchFixture(t, () => stream([event({ choices: [{ delta: { content: "¡Sí 🚀!", reasoning_content: "opaque reasoning" } }] }), event({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 3 } } }), event("[DONE]")], 1));
  let text = "";
  const turn = await new OpenAICompatibleProvider("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "fixture").stream(request(), (chunk) => { text += chunk; });
  assert.equal(turn.content, "¡Sí 🚀!");
  assert.equal(text, turn.content);
  assert.equal(turn.responseState?.reasoningContent, "opaque reasoning");
  assert.equal(turn.cachedTokens, 3);
  assert.equal(turn.outputTokens, 8);
});

test("stream errors, malformed JSON and broken streams cannot become successful completions", async (t) => {
  const adapter = new OpenAICompatibleProvider("fixture", "Fixture", "https://fixture.invalid", "fixture");
  for (const frames of [[event({ error: { message: "provider overloaded" } })], [event("{invalid")], [event({ choices: [{ delta: { content: "partial" } }] })]]) {
    fetchFixture(t, () => stream(frames));
    await assert.rejects(adapter.stream(request(), () => undefined));
  }
  let cancelled = false;
  fetchFixture(t, () => stream([event({ error: { message: "stop" } })], 40, false, () => { cancelled = true; }));
  await assert.rejects(adapter.stream(request(), () => undefined));
  assert.equal(cancelled, true);
  fetchFixture(t, () => json({ error: { message: "failed inside HTTP 200" } }));
  await assert.rejects(adapter.complete(request()), { code: "PROVIDER_ERROR" });
});

test("wire tool names remain unique, bounded and correctly decoded", async (t) => {
  const tools = [tool("fs.read"), tool("fs_read"), tool("mcp." + "long_name".repeat(12))];
  fetchFixture(t, (_url, init) => {
    const payload = JSON.parse(String(init.body));
    const names = payload.tools.map((entry: { function: { name: string } }) => entry.function.name);
    assert.equal(new Set(names).size, tools.length);
    for (const name of names) assert.match(name, /^[A-Za-z0-9_-]{1,64}$/);
    return stream([event({ choices: [{ delta: { tool_calls: names.map((name: string, index: number) => ({ index, id: `call_${index}`, function: { name, arguments: "{}" } })) }, finish_reason: "tool_calls" }] }), event("[DONE]")]);
  });
  const turn = await new OpenAICompatibleProvider("fixture", "Fixture", "https://fixture.invalid", "fixture").stream({ ...request(), tools }, () => undefined);
  assert.deepEqual(turn.toolCalls.map((call) => call.name), tools.map((entry) => entry.name));
});

test("tool arguments must be JSON objects", async (t) => {
  fetchFixture(t, () => json({ choices: [{ message: { tool_calls: [{ id: "call", function: { name: "unsafe", arguments: "[]" } }] }, finish_reason: "tool_calls" }] }));
  await assert.rejects(new OpenAICompatibleProvider("fixture", "Fixture", "https://fixture.invalid", "fixture").complete(request()), { code: "INVALID_PROVIDER_RESPONSE" });
});

test("modern OpenAI uses Responses with the output cap and replays encrypted reasoning", async (t) => {
  let count = 0;
  let output: Array<Record<string, unknown>> = [];
  fetchFixture(t, (url, init) => {
    assert.equal(url.pathname, "/v1/responses");
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.store, false); assert.equal(payload.stream, true); assert.equal(payload.max_output_tokens, 17);
    if (count++ === 0) {
      output = [{ type: "reasoning", id: "rs_fixture", encrypted_content: "fixture-encrypted", summary: [] }, { type: "function_call", id: "fc_fixture", call_id: "call_1", name: payload.tools[0].name, arguments: '{"path":"a.ts"}' }];
      return stream([completed(output)]);
    }
    assert.deepEqual(payload.input.slice(1, 3), output);
    assert.equal(payload.input[3].type, "function_call_output");
    return stream([completed([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Verified." }] }])]);
  });
  const adapter = new OpenAICompatibleProvider("openai", "OpenAI", "https://api.openai.com/v1", "fixture");
  const initial = { ...request("gpt-6.1-sol"), maxOutputTokens: 17, tools: [tool("fs.read")] };
  const turn = await adapter.stream(initial, () => undefined);
  assert.equal(turn.toolCalls[0]?.name, "fs.read");
  const result = await adapter.complete({ ...initial, messages: [...initial.messages, { role: "assistant", content: turn.content, toolCalls: turn.toolCalls, responseState: turn.responseState }, { role: "tool", content: "file content", toolCallId: "call_1", toolName: "fs.read" }] });
  assert.equal(result.content, "Verified.");
});

test("legacy OpenAI uses max_completion_tokens and reports streamed usage", async (t) => {
  fetchFixture(t, (url, init) => {
    assert.equal(url.pathname, "/v1/chat/completions");
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.max_completion_tokens, 9); assert.equal(payload.max_tokens, undefined); assert.equal(payload.stream_options.include_usage, true);
    return stream([event({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }), event("[DONE]")]);
  });
  await new OpenAICompatibleProvider("openai", "OpenAI", "https://api.openai.com/v1", "fixture").stream({ ...request("gpt-4-turbo"), maxOutputTokens: 9 }, () => undefined);
});

test("ChatGPT preserves account catalog ordering and the explicit token budget", async (t) => {
  const adapter = new ChatGPTPlanProvider(); adapter.setOAuthCredential(credential());
  fetchFixture(t, (url, init) => {
    if (url.pathname === "/v1/models") return json(catalog);
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.max_output_tokens, 23); assert.equal(payload.store, false); assert.equal(payload.stream, true);
    return stream([completed([{ type: "message", content: [{ type: "output_text", text: "Done" }] }])]);
  });
  assert.deepEqual((await adapter.listModels()).map((model) => model.id), ["model-b", "model-a"]);
  assert.equal((await adapter.stream({ ...request(), maxOutputTokens: 23 }, () => undefined)).content, "Done");
});

test("ChatGPT distinguishes a late subscription limit from completed inference", async (t) => {
  const adapter = new ChatGPTPlanProvider(); adapter.setOAuthCredential(credential());
  fetchFixture(t, () => stream([event({ delta: "partial" }, "response.output_text.delta"), event({ response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "Plan limit reached" } } }, "response.failed")]));
  await assert.rejects(adapter.stream(request(), () => undefined), { code: "PROVIDER_USAGE_LIMIT" });
  fetchFixture(t, () => stream([event({ delta: "partial" }, "response.output_text.delta")]));
  await assert.rejects(adapter.stream(request(), () => undefined), { code: "PROVIDER_STREAM_INCOMPLETE" });
});

test("disconnect or account switch during refresh never resurrects old credentials", async (t) => {
  for (const next of [null, credential("new")]) {
    const rotations: ChatGPTOAuthCredential[] = [];
    const adapter = new ChatGPTPlanProvider((value) => rotations.push(value)); adapter.setOAuthCredential(credential("old", 1));
    let release!: (response: Response) => void;
    let started!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { started = resolve; });
    fetchFixture(t, () => { started(); return new Promise<Response>((resolve) => { release = resolve; }); });
    const pending = adapter.listModels();
    await refreshStarted;
    adapter.setOAuthCredential(next);
    release(json({ access_token: "fixture-refreshed", refresh_token: "fixture-rotated", expires_in: 3600 }));
    await assert.rejects(pending);
    assert.equal(rotations.length, 0);
    assert.equal(adapter.configured, next !== null);
  }
});

test("concurrent callers share refresh while cancelling one preserves token rotation", async (t) => {
  const rotations: ChatGPTOAuthCredential[] = [];
  const adapter = new ChatGPTPlanProvider((value) => rotations.push(value)); adapter.setOAuthCredential(credential("old", 1));
  let release!: (response: Response) => void; let started!: () => void; let refreshCalls = 0;
  const refreshStarted = new Promise<void>((resolve) => { started = resolve; });
  fetchFixture(t, (url, init) => {
    if (url.pathname.endsWith("/token")) { refreshCalls++; started(); return new Promise<Response>((resolve) => { release = resolve; }); }
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-refreshed"); return json(catalog);
  });
  const controller = new AbortController();
  const first = adapter.listModels(controller.signal); await refreshStarted;
  const second = adapter.listModels(); controller.abort();
  await assert.rejects(first);
  release(json({ access_token: "fixture-refreshed", refresh_token: "fixture-rotated", expires_in: 3600 }));
  assert.equal((await second).length, 2); assert.equal(refreshCalls, 1); assert.equal(rotations.length, 1);
});

test("Anthropic preserves signed blocks, groups parallel results and counts all input tokens", async (t) => {
  const adapter = new ProviderRegistry().get("anthropic")!; adapter.setCredential!("fixture");
  let count = 0;
  fetchFixture(t, (_url, init) => {
    const payload = JSON.parse(String(init.body));
    if (count++ === 0) return stream([
      event({ message: { usage: { input_tokens: 10, cache_creation_input_tokens: 30, cache_read_input_tokens: 20 } } }, "message_start"),
      event({ index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }, "content_block_start"), event({ index: 0, delta: { type: "signature_delta", signature: "signed-thought" } }, "content_block_delta"),
      event({ index: 1, content_block: { type: "tool_use", id: "call_1", name: payload.tools[0].name, input: {} } }, "content_block_start"), event({ index: 1, delta: { type: "input_json_delta", partial_json: "{}" } }, "content_block_delta"),
      event({ delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }, "message_delta"), event({}, "message_stop"),
    ]);
    assert.equal(payload.messages[1].content[0].signature, "signed-thought"); assert.equal(payload.messages[2].content.length, 2);
    return json({ content: [{ type: "text", text: "Done" }], stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 1 } });
  });
  const initial = { ...request(), tools: [tool("fs.read")] };
  const turn = await adapter.stream(initial, () => undefined);
  assert.equal(turn.inputTokens, 60); assert.equal(turn.cachedTokens, 20); assert.equal(turn.outputTokens, 7);
  await adapter.complete({ ...initial, messages: [...initial.messages, { role: "assistant", content: "", toolCalls: turn.toolCalls, responseState: turn.responseState }, ...[1, 2].map((id) => ({ role: "tool" as const, content: "result", toolCallId: `call_${id}`, toolName: "fs.read" }))] });
});

test("Anthropic rejects an error event or a stream missing message_stop", async (t) => {
  const adapter = new ProviderRegistry().get("anthropic")!; adapter.setCredential!("fixture");
  for (const frames of [[event({ error: { type: "overloaded_error", message: "Overloaded" } }, "error")], [event({ message: { usage: {} } }, "message_start")]]) {
    fetchFixture(t, () => stream(frames)); await assert.rejects(adapter.stream(request(), () => undefined));
  }
});

test("Gemini retains thought signatures, groups tool results and includes reasoning token usage", async (t) => {
  const adapter = new ProviderRegistry().get("gemini")!; adapter.setCredential!("fixture"); let count = 0;
  fetchFixture(t, (_url, init) => {
    const payload = JSON.parse(String(init.body));
    if (count++ === 0) return stream([event({ candidates: [{ content: { parts: [{ text: "private thought", thought: true }, { functionCall: { id: "call_1", name: payload.tools[0].functionDeclarations[0].name, args: {} }, thoughtSignature: "signed-1" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4, thoughtsTokenCount: 9 } })]);
    assert.equal(payload.contents[1].parts[1].thoughtSignature, "signed-1"); assert.equal(payload.contents[2].parts.length, 2); assert.equal(payload.contents[2].parts[0].functionResponse.id, "call_1");
    return json({ candidates: [{ content: { parts: [{ text: "Done" }] }, finishReason: "STOP" }] });
  });
  const initial = { ...request(), tools: [tool("fs.read")] };
  const turn = await adapter.stream(initial, () => undefined);
  assert.equal(turn.content, ""); assert.equal(turn.outputTokens, 13); assert.equal(turn.toolCalls[0]?.id, "call_1");
  await adapter.complete({ ...initial, messages: [...initial.messages, { role: "assistant", content: "", toolCalls: turn.toolCalls, responseState: turn.responseState }, ...[1, 2].map((id) => ({ role: "tool" as const, content: "result", toolCallId: `call_${id}`, toolName: "fs.read" }))] });
});

test("Gemini errors and interrupted output are failures, safety blocks keep their stop reason", async (t) => {
  const adapter = new ProviderRegistry().get("gemini")!; adapter.setCredential!("fixture");
  for (const data of [{ error: { message: "quota exceeded" } }, { candidates: [{ content: { parts: [{ text: "partial" }] } }] }]) {
    fetchFixture(t, () => stream([event(data)])); await assert.rejects(adapter.stream(request(), () => undefined));
  }
  fetchFixture(t, () => stream([event({ promptFeedback: { blockReason: "SAFETY" } })]));
  assert.equal((await adapter.stream(request(), () => undefined)).finishReason, "SAFETY");
});


test("reasoning selectors follow each native model and OpenRouter's live per-model catalog", async (t) => {
  fetchFixture(t, () => json({ data: [{ id: "gpt-4.1" }, { id: "gpt-5.1" }, { id: "gpt-5.2" }, { id: "gpt-6-astra" }] }));
  const openai = new OpenAICompatibleProvider("openai", "OpenAI", "https://api.openai.com/v1", "fixture");
  const models = await openai.listModels();
  assert.deepEqual(models[0]?.reasoningEfforts, []);
  assert.deepEqual(models[1]?.reasoningEfforts, ["none", "low", "medium", "high"]);
  assert.deepEqual(models[2]?.reasoningEfforts, ["none", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(models[3]?.reasoningEfforts, ["low", "medium", "high", "xhigh", "max"]);
  fetchFixture(t, () => json({ data: [openRouterChatModel("routed", { context_length: 128_000, reasoning: { supported_efforts: ["high", "low", "none"], mandatory: true } }), openRouterChatModel("automatic-router"), openRouterChatModel("gateway", { reasoning: { supported_efforts: null } })] }));
  const router = new OpenAICompatibleProvider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "fixture");
  const routed = await router.listModels();
  assert.deepEqual(routed.find((model) => model.id === "routed")?.reasoningEfforts, ["low", "high"]);
  assert.equal(routed.find((model) => model.id === "routed")?.contextWindowTokens, 128_000);
  assert.deepEqual(routed.find((model) => model.id === "automatic-router")?.reasoningEfforts, []);
  assert.deepEqual(routed.find((model) => model.id === "gateway")?.reasoningEfforts, []);
  let sent = 0;
  fetchFixture(t, (_url, init) => { sent++; const payload = JSON.parse(String(init.body)); assert.deepEqual(payload.reasoning, { effort: "low" }); assert.deepEqual(payload.provider, { require_parameters: true }); return json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }); });
  await assert.rejects(router.complete({ ...request("routed"), reasoningEffort: "medium" }), /does not support/);
  assert.equal(sent, 0);
  await router.complete({ ...request("routed"), reasoningEffort: "low" });
  assert.equal(sent, 1);
});

test("native APIs receive the selected effort in their own request field and reject unsupported levels before inference", async (t) => {
  const openai = new OpenAICompatibleProvider("openai", "OpenAI", "https://api.openai.com/v1", "fixture");
  fetchFixture(t, (_url, init) => { assert.deepEqual(JSON.parse(String(init.body)).reasoning, { effort: "xhigh" }); return stream([completed()]); });
  await openai.complete({ ...request("gpt-5.2"), reasoningEffort: "xhigh" });
  await assert.rejects(openai.complete({ ...request("gpt-4.1"), reasoningEffort: "high" }), /does not support/);
  const registry = new ProviderRegistry();
  const claude = registry.get("anthropic")!; claude.setCredential!("fixture");
  fetchFixture(t, (_url, init) => { assert.deepEqual(JSON.parse(String(init.body)).output_config, { effort: "max" }); return json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }); });
  await claude.complete({ ...request("claude-opus-4-6"), reasoningEffort: "max" });
  await assert.rejects(claude.complete({ ...request("claude-opus-4-6"), reasoningEffort: "xhigh" }), /does not support/);
  const gemini = registry.get("gemini")!; gemini.setCredential!("fixture");
  fetchFixture(t, (_url, init) => { assert.deepEqual(JSON.parse(String(init.body)).generationConfig.thinkingConfig, { thinkingLevel: "minimal" }); return json({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }); });
  await gemini.complete({ ...request("gemini-3-flash-preview"), reasoningEffort: "minimal" });
  await assert.rejects(gemini.complete({ ...request("gemini-3-pro-preview"), reasoningEffort: "medium" }), /does not support/);
  const xai = registry.get("xai")!; xai.setCredential!("fixture");
  fetchFixture(t, (_url, init) => { assert.equal(JSON.parse(String(init.body)).reasoning_effort, "high"); return json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }); });
  await xai.complete({ ...request("grok-4.5"), reasoningEffort: "high" });
  await assert.rejects(xai.complete({ ...request("grok-4.5"), reasoningEffort: "xhigh" }), /does not support/);
});


test("MiniMax subscription uses its own key, authenticated catalog and streaming tool transport", async (t) => {
  const adapter = new MiniMaxPlanProvider();
  adapter.setCredential(undefined);
  assert.equal((await adapter.listModels())[0]?.available, false);
  assert.throws(() => adapter.setCredential("sk-api-standard"), /subscription key/);
  adapter.setCredential("sk-cp-fixture");
  fetchFixture(t, (url, init) => {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer sk-cp-fixture");
    assert.equal(url.origin, "https://api.minimax.io");
    if (url.pathname.endsWith("/models")) return json({ data: [{ id: "MiniMax-M3.1-Flash-Preview" }, { id: "MiniMax-M3" }] });
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, "MiniMax-M3.1-Flash-Preview");
    assert.match(body.tools[0].function.name, /^fs_read_/);
    return stream([event({ choices: [{ delta: { reasoning_content: "check", content: "Ready" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 3 } }), event("[DONE]")]);
  });
  const models = await adapter.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0]?.priceKind, "subscription");
  assert.equal(models[0]?.available, true);
  const result = await adapter.stream({ ...request("MiniMax-M3.1-Flash-Preview"), tools: [tool("fs.read")] }, () => undefined);
  assert.equal(result.content, "Ready");
  assert.equal(result.responseState?.reasoningContent, "check");
  adapter.setCredential(undefined);
  assert.equal(adapter.configured, false);
});

test("MiniMax rejects a revoked subscription instead of reporting it ready", async (t) => {
  const adapter = new MiniMaxPlanProvider(); adapter.setCredential("sk-cp-invalid");
  fetchFixture(t, () => json({ error: "invalid_api_key" }, 401));
  await assert.rejects(adapter.listModels(), /discovery failed \(401\)/);
});
