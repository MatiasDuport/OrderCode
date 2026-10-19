import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import type { ExecutionBudget } from "@ordercode/shared";
import { createHarnessRuntime } from "./orchestrator.js";
import type { ProviderAdapter } from "./providers.js";
import type { ProviderModel, ProviderRequest, ProviderTurn } from "./types.js";

function provider(handle: (request: ProviderRequest) => Promise<ProviderTurn>, pricing?: ProviderModel["pricing"]): ProviderAdapter {
  return { id: "fixture", label: "Controlled provider fixture", configured: true, baseUrl: "local://fixture",
    complete: handle, stream: (request) => handle(request),
    async listModels() { return [{ id: "fixture-model", providerId: "fixture", label: "Fixture", available: true, capabilities: ["chat", "streaming", "tool-calling"], priceKind: pricing?.inputPerMillionUsd === 0 && pricing.outputPerMillionUsd === 0 ? "free" : "unknown", ...(pricing ? { pricing } : {}) }]; },
  };
}
const done = (): ProviderTurn => ({ content: "Verified fixture result.", toolCalls: [], finishReason: "stop", inputTokens: 2, outputTokens: 1 });
async function fixture(t: TestContext, adapter: ProviderAdapter) {
  const root = await mkdtemp(join(tmpdir(), "ordercode-regression-"));
  const project = join(root, "project"); const data = join(root, "data");
  await mkdir(project); await writeFile(join(project, "source.txt"), "source content");
  const context = { project, data, runtime: await createHarnessRuntime({ dataDirectory: data, providers: [adapter] }) };
  t.after(async () => { await context.runtime.close(); await rm(root, { recursive: true, force: true }); });
  return context;
}
const config = (projectPath: string) => ({ projectPath, mode: "build" as const, permissionProfile: "guided" as const, providerId: "fixture", modelId: "fixture-model" });
const limits = (patch: Partial<ExecutionBudget>): ExecutionBudget => ({ maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxDurationMs: null, maxToolCalls: null, ...patch });

test("binary files cannot be decoded or overwritten as text and parallel tool events keep identities", async (t) => {
  const env = await fixture(t, provider(async () => done()));
  const session = env.runtime.createSession({ ...config(env.project), permissionProfile: "advanced" });
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x80]);
  await writeFile(join(env.project, 'photo.jpg'), bytes);
  assert.equal((await env.runtime.invokeTool(session.id, 'fs.read', { path: 'photo.jpg' })).status, 'failed');
  assert.equal((await env.runtime.invokeTool(session.id, 'fs.write', { path: 'photo.jpg', content: 'replacement' })).status, 'failed');
  assert.deepEqual(await readFile(join(env.project, 'photo.jpg')), bytes);
  const results = await Promise.all([env.runtime.invokeTool(session.id, 'fs.read', { path: 'source.txt' }), env.runtime.invokeTool(session.id, 'fs.read', { path: 'source.txt' })]);
  assert.ok(results.every((result) => result.status === 'completed'));
  const eventCount = env.runtime.listEvents(session.id).length;
  assert.equal((await env.runtime.invokeTool(session.id, 'fs.read', { path: 'source.txt' }, 'general', false)).status, 'completed');
  assert.equal(env.runtime.listEvents(session.id).length, eventCount, 'background read-only refreshes should not appear as agent tasks');
  const writeStartsBefore = env.runtime.listEvents(session.id).filter((event) => event.type === 'tool.started' && event.payload.toolName === 'fs.write').length;
  await env.runtime.invokeTool(session.id, 'fs.write', { path: 'tracked.txt', content: 'tracked' }, 'general', false);
  assert.equal(env.runtime.listEvents(session.id).filter((event) => event.type === 'tool.started' && event.payload.toolName === 'fs.write').length, writeStartsBefore + 1, 'write actions must remain visible in activity');
  const events = env.runtime.listEvents(session.id).filter((event) => event.type === 'tool.started' || event.type === 'tool.completed');
  const starts = events.filter((event) => event.type === 'tool.started');
  assert.equal(new Set(starts.map((event) => event.payload.invocationId)).size, starts.length);
  for (const start of starts) assert.equal(events.filter((event) => event.type === 'tool.completed' && event.payload.invocationId === start.payload.invocationId).length, 1);
});

test("multiple approved tools survive restart and finish their batch before the next model call", async (t) => {
  let calls = 0;
  const responseState = { responses: [{ type: "reasoning", encrypted_content: "fixture-signed-state" }] };
  const adapter = provider(async (request) => {
    if (calls++ === 0) return { content: "Apply both changes.", finishReason: "tool_calls", responseState, toolCalls: [
      { id: "write-1", name: "fs.write", arguments: { path: "one.txt", content: "one" } },
      { id: "write-2", name: "fs.write", arguments: { path: "two.txt", content: "two" } },
      { id: "read-3", name: "fs.read", arguments: { path: "two.txt" } },
    ] };
    assert.deepEqual(request.messages.find((message) => message.toolCalls?.length)?.responseState, responseState);
    assert.deepEqual(request.messages.filter((message) => message.role === "tool").map((message) => message.toolCallId), ["write-1", "write-2", "read-3"]);
    return done();
  });
  const env = await fixture(t, adapter);
  const session = env.runtime.createSession(config(env.project));
  let run = await env.runtime.run({ sessionId: session.id, goal: "Write two files and verify the second." });
  assert.equal(run.state, "WAITING_APPROVAL"); assert.ok(run.pendingPermission);
  assert.throws(() => env.runtime.updateSession(session.id, { modelId: "other" }), { code: "APPROVAL_PENDING" });
  const first = await env.runtime.resolvePermission(run.pendingPermission.id, "once");
  assert.ok("state" in first); assert.equal(first.state, "WAITING_APPROVAL"); assert.ok(first.pendingPermission);
  assert.equal(calls, 1); assert.equal(await readFile(join(env.project, "one.txt"), "utf8"), "one");
  await env.runtime.close();
  env.runtime = await createHarnessRuntime({ dataDirectory: env.data, providers: [adapter] });
  const result = await env.runtime.resolvePermission(first.pendingPermission.id, "once");
  assert.ok("state" in result); assert.equal(result.state, "COMPLETED"); assert.equal(calls, 2);
  assert.equal(await readFile(join(env.project, "two.txt"), "utf8"), "two");
  assert.equal(result.usage.toolCalls, 3);
});

test("an unrelated editor approval does not discard a suspended agent checkpoint", async (t) => {
  let calls = 0;
  const env = await fixture(t, provider(async () => calls++ === 0 ? { content: "", finishReason: "tool_calls", toolCalls: [{ id: "write", name: "fs.write", arguments: { path: "agent.txt", content: "agent" } }] } : done()));
  const session = env.runtime.createSession(config(env.project));
  const run = await env.runtime.run({ sessionId: session.id, goal: "Create a file." }); assert.ok(run.pendingPermission);
  const editor = await env.runtime.invokeTool(session.id, "fs.write", { path: "editor.txt", content: "editor" });
  const pending = (editor.data as { permissionRequest: { id: string } }).permissionRequest;
  await env.runtime.resolvePermission(pending.id, "once");
  assert.ok(env.runtime.persistence.getCheckpoint(session.id));
  assert.equal((await env.runtime.invokeTool(session.id, "fs.write", { path: "editor.txt", content: "editor" })).status, "completed");
  const result = await env.runtime.resolvePermission(run.pendingPermission.id, "once");
  assert.ok("state" in result); assert.equal(result.state, "COMPLETED");
});

test("truncated output cannot execute tools or be marked completed", async (t) => {
  const env = await fixture(t, provider(async () => ({ content: "Partial response", finishReason: "length", inputTokens: 3, outputTokens: 2, toolCalls: [{ id: "write", name: "fs.write", arguments: { path: "unsafe.txt", content: "must not execute" } }] })));
  const session = env.runtime.createSession({ ...config(env.project), permissionProfile: "auto" });
  const result = await env.runtime.run({ sessionId: session.id, goal: "Create a file." });
  assert.equal(result.state, "WAITING_USER"); assert.equal(result.usage.toolCalls, 0); assert.equal(result.usage.outputTokens, 2);
  await assert.rejects(readFile(join(env.project, "unsafe.txt")), { code: "ENOENT" });
  assert.match(result.assistantMessage?.content ?? "", /incomplete/);
});

test("verified free models can execute with a zero-dollar ceiling without inventing token counts", async (t) => {
  let calls = 0;
  const env = await fixture(t, provider(async () => calls++ === 0 ? { content: "", finishReason: "tool_calls", toolCalls: [{ id: "read", name: "fs.read", arguments: { path: "source.txt" } }] } : { content: "Done", finishReason: "stop", toolCalls: [] }, { inputPerMillionUsd: 0, outputPerMillionUsd: 0, updatedAt: new Date().toISOString() }));
  const session = env.runtime.createSession({ ...config(env.project), freeOnly: true, budget: limits({ maxCostUsd: 0 }) });
  const result = await env.runtime.run({ sessionId: session.id, goal: "Read the source." });
  assert.equal(result.state, "COMPLETED"); assert.equal(calls, 2); assert.equal(result.usage.costUsd, 0);
  assert.equal(env.runtime.getUsageAnalytics({ projectPath: env.project, days: 0 }).measuredCalls, 0);
});

test("free-only approval recovery rechecks promotions before sending another model call", async (t) => {
  let calls = 0;
  let free = true;
  const adapter = provider(async () => { calls++; return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "write", name: "fs.write", arguments: { path: "approved.txt", content: "approved" } }] }; });
  adapter.listModels = async () => [{ id: "fixture-model", providerId: "fixture", label: "Fixture", available: true, capabilities: ["chat", "tool-calling"], priceKind: free ? "free" : "paid", pricing: { inputPerMillionUsd: free ? 0 : 1, outputPerMillionUsd: free ? 0 : 2, updatedAt: new Date().toISOString() } }];
  const env = await fixture(t, adapter);
  const session = env.runtime.createSession({ ...config(env.project), freeOnly: true });
  const pending = await env.runtime.run({ sessionId: session.id, goal: "Write an approved file." });
  assert.ok(pending.pendingPermission);
  free = false;
  const result = await env.runtime.resolvePermission(pending.pendingPermission.id, "once");
  assert.ok("state" in result); assert.equal(result.state, "WAITING_USER");
  assert.equal(calls, 1);
  assert.match(result.reason ?? "", /no longer has verified free/);
});

test("a later priced call does not turn an unknown cumulative cost into an exact total", async (t) => {
  let calls = 0;
  const env = await fixture(t, provider(async () => calls++ === 0 ? { content: "", finishReason: "tool_calls", toolCalls: [{ id: "read", name: "fs.read", arguments: { path: "source.txt" } }] } : { ...done(), costUsd: 0.01, costKind: "exact" }));
  const result = await env.runtime.run({ sessionId: env.runtime.createSession(config(env.project)).id, goal: "Read source." });
  assert.equal(result.usage.costKind, "unknown");
});

test("pre-cancelled runs and zero-duration budgets send no inference", async (t) => {
  let calls = 0;
  const env = await fixture(t, provider(async () => { calls++; return done(); }));
  const controller = new AbortController(); controller.abort();
  assert.equal((await env.runtime.run({ sessionId: env.runtime.createSession(config(env.project)).id, goal: "Cancelled", signal: controller.signal })).state, "CANCELLED");
  assert.equal((await env.runtime.run({ sessionId: env.runtime.createSession({ ...config(env.project), budget: limits({ maxDurationMs: 0 }) }).id, goal: "No time" })).state, "WAITING_USER");
  assert.equal(calls, 0);
});

test("agent tests respect output and cost budgets, support cancellation and exclude concurrent tests", async (t) => {
  let begin!: () => void;
  const started = new Promise<void>((resolve) => { begin = resolve; });
  let hold = false;
  let calls = 0;
  const env = await fixture(t, provider(async (request) => {
    calls++; assert.equal(request.maxOutputTokens, 5);
    if (hold) { begin(); await new Promise<never>((_resolve, reject) => request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true })); }
    return done();
  }));
  const profile = env.runtime.agents.save({ name: "Fixture", description: "Test", instructions: "Return facts", toolAllowlist: [], enabled: true });
  const session = env.runtime.createSession({ ...config(env.project), budget: limits({ maxOutputTokens: 5 }) });
  await env.runtime.testAgent(session.id, profile.id, "Test fixture");
  env.runtime.updateSession(session.id, { budget: limits({ maxOutputTokens: 5, maxCostUsd: 0.01 }) });
  await assert.rejects(env.runtime.testAgent(session.id, profile.id, "Test fixture"), { code: "COST_BUDGET_UNAVAILABLE" }); assert.equal(calls, 1);
  env.runtime.updateSession(session.id, { budget: limits({ maxOutputTokens: 5 }) }); hold = true;
  const pending = env.runtime.testAgent(session.id, profile.id, "Long fixture"); await started;
  await assert.rejects(env.runtime.testAgent(session.id, profile.id, "Duplicate fixture"), { code: "SESSION_BUSY" });
  assert.equal(env.runtime.cancel(session.id).cancelled, true); await assert.rejects(pending);
});

test("closing runtime cancels active inference before closing persistence", async (t) => {
  let begin!: () => void;
  const started = new Promise<void>((resolve) => { begin = resolve; });
  const env = await fixture(t, provider(async (request) => { begin(); await new Promise<never>((_resolve, reject) => request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true })); return done(); }));
  const pending = env.runtime.run({ sessionId: env.runtime.createSession(config(env.project)).id, goal: "Wait for cancellation" });
  await started;
  await env.runtime.close();
  assert.equal((await pending).state, "CANCELLED");
  await assert.rejects(env.runtime.run({ sessionId: "closed", goal: "Do not run" }), { code: "RUNTIME_CLOSING" });
});

test("read-only UI tools remain usable during inference while side effects are blocked", async (t) => {
  let begin!: () => void; const started = new Promise<void>((resolve) => { begin = resolve; });
  const env = await fixture(t, provider(async (request) => { begin(); await new Promise<never>((_resolve, reject) => request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true })); return done(); }));
  const session = env.runtime.createSession(config(env.project));
  const pending = env.runtime.run({ sessionId: session.id, goal: "Long analysis" }); await started;
  assert.equal((await env.runtime.invokeTool(session.id, "fs.read", { path: "source.txt" })).status, "completed");
  await assert.rejects(env.runtime.invokeTool(session.id, "fs.write", { path: "blocked.txt", content: "blocked" }), { code: "SESSION_BUSY" });
  env.runtime.cancel(session.id); assert.equal((await pending).state, "CANCELLED");
});

test("cancellation after approving a tool remains CANCELLED instead of FAILED", async (t) => {
  let calls = 0; let begin!: () => void; const started = new Promise<void>((resolve) => { begin = resolve; });
  const env = await fixture(t, provider(async (request) => {
    if (calls++ === 0) return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "write", name: "fs.write", arguments: { path: "done.txt", content: "done" } }] };
    begin(); await new Promise<never>((_resolve, reject) => request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true })); return done();
  }));
  const session = env.runtime.createSession(config(env.project));
  const run = await env.runtime.run({ sessionId: session.id, goal: "Create and explain." }); assert.ok(run.pendingPermission);
  const pending = env.runtime.resolvePermission(run.pendingPermission.id, "once"); await started;
  env.runtime.cancel(session.id);
  const result = await pending; assert.ok("state" in result); assert.equal(result.state, "CANCELLED");
});

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) { try { return await readFile(path, "utf8"); } catch { await delay(25); } }
  throw new Error(`Process fixture did not start: ${path}`);
}

test("cancelling a direct command terminates the actual managed child process", { timeout: 15_000 }, async (t) => {
  const env = await fixture(t, provider(async () => done()));
  await writeFile(join(env.project, "child.cjs"), 'require("node:fs").writeFileSync("child.pid", String(process.pid)); setInterval(() => {}, 1000);');
  const session = env.runtime.createSession({ ...config(env.project), permissionProfile: "advanced" });
  const pending = env.runtime.invokeTool(session.id, "process.exec", { command: 'node child.cjs', timeoutMs: 10_000 });
  const pid = Number(await waitForFile(join(env.project, "child.pid")));
  assert.equal(env.runtime.cancel(session.id).cancelled, true);
  const result = await pending; assert.equal(result.status, "cancelled");
  for (let attempt = 0; attempt < 40; attempt++) { try { process.kill(pid, 0); await delay(25); } catch { return; } }
  assert.fail("The command's child remained alive after cancellation.");
});

test("command output preserves UTF-8 split across process chunks", { timeout: 15_000 }, async (t) => {
  const env = await fixture(t, provider(async () => done()));
  await writeFile(join(env.project, "utf8.cjs"), 'const bytes=Buffer.from("sí 🚀"); let i=0; const timer=setInterval(()=>{if(i===bytes.length){clearInterval(timer);return;}process.stdout.write(bytes.subarray(i,i+1));i++;},5);');
  const result = await env.runtime.invokeTool(env.runtime.createSession({ ...config(env.project), permissionProfile: "advanced" }).id, "process.exec", { command: 'node utf8.cjs' });
  assert.equal(result.status, "completed"); assert.equal((result.data as { stdout: string }).stdout, "sí 🚀");
});

test("Windows process commands use PowerShell syntax", { skip: process.platform !== "win32", timeout: 15_000 }, async (t) => {
  const env = await fixture(t, provider(async () => done()));
  const session = env.runtime.createSession({ ...config(env.project), permissionProfile: "advanced" });
  const result = await env.runtime.invokeTool(session.id, "process.exec", { command: "Get-ChildItem -Name source.txt | Select-Object -First 1" });
  assert.equal(result.status, "completed", result.summary);
  assert.equal((result.data as { stdout: string }).stdout.trim(), "source.txt");
});

test("runaway command output is bounded and stops the managed process", { timeout: 15_000 }, async (t) => {
  const env = await fixture(t, provider(async () => done()));
  await writeFile(join(env.project, "output.cjs"), 'process.stdout.write("x".repeat(2_100_000)); setInterval(()=>{},1000);');
  const result = await env.runtime.invokeTool(env.runtime.createSession({ ...config(env.project), permissionProfile: "advanced" }).id, "process.exec", { command: 'node output.cjs' });
  assert.equal(result.status, "failed"); assert.equal((result.data as { outputLimitExceeded: boolean }).outputLimitExceeded, true);
  assert.ok(JSON.stringify(result).length < 20_000); assert.ok(result.logRef);
});

test("code intelligence excludes tool resources and caches and shares concurrent indexing", async (t) => {
  const env = await fixture(t, provider(async () => done()));
  for (const path of [".agents/skills/asset", ".venv/lib", "coverage"]) {
    await mkdir(join(env.project, path), { recursive: true });
    await writeFile(join(env.project, path, "ignored.ts"), "export function ignoredDependency() {}\n");
  }
  await writeFile(join(env.project, "main.ts"), "export function projectFunction() {}\n");
  const [first, concurrent] = await Promise.all([env.runtime.code.index(env.project), env.runtime.code.index(env.project)]);
  assert.equal(first, concurrent); assert.equal(first.files, 1);
  assert.equal((await env.runtime.code.index(env.project)).updatedFiles, 0);
  assert.deepEqual(await env.runtime.code.search(env.project, "ignoredDependency"), []);
});


test("reasoning effort persists, inherits into tool turns and specialists, resets on Auto, and blocks unsupported inference", async (t) => {
  const efforts: Array<string | undefined> = [];
  const adapter = provider(async (request) => {
    efforts.push(request.reasoningEffort);
    if (efforts.length === 1) return { ...done(), toolCalls: [{ id: "delegate-1", name: "agents.delegate", arguments: { role: "review", task: "Review supplied context", context: "The project has one source file." } }], finishReason: "tool_calls" };
    return done();
  });
  const list = adapter.listModels;
  adapter.listModels = async (signal) => (await list(signal)).map((model) => ({ ...model, reasoningEfforts: ["low", "high"] }));
  const env = await fixture(t, adapter);
  const session = env.runtime.createSession({ ...config(env.project), reasoningEffort: "high" });
  assert.equal(env.runtime.getSession(session.id).reasoningEffort, "high");
  await env.runtime.close();
  env.runtime = await createHarnessRuntime({ dataDirectory: env.data, providers: [adapter] });
  assert.equal(env.runtime.getSession(session.id).reasoningEffort, "high");
  assert.equal((await env.runtime.run({ sessionId: session.id, goal: "Inspect source via the review specialist." })).state, "COMPLETED");
  assert.deepEqual(efforts, ["high", "high", "high"]);
  assert.equal((await env.runtime.run({ sessionId: session.id, goal: "Hello", reasoningEffort: null })).state, "COMPLETED");
  assert.equal(efforts.at(-1), undefined);
  assert.equal(env.runtime.getSession(session.id).reasoningEffort, undefined);
  env.runtime.updateSession(session.id, { reasoningEffort: "high" });
  assert.equal(env.runtime.updateSession(session.id, { reasoningEffort: null }).reasoningEffort, undefined);
  const before = efforts.length;
  const result = await env.runtime.run({ sessionId: session.id, goal: "Unsupported level", reasoningEffort: "xhigh" });
  assert.equal(result.state, "WAITING_USER");
  assert.equal(efforts.length, before);
  assert.match(result.reason ?? "", /does not support/);
});


test("Free Only blocks unavailable models even when their zero price is verified", async (t) => {
  let calls = 0;
  const adapter = provider(async () => { calls++; return done(); }, { inputPerMillionUsd: 0, outputPerMillionUsd: 0, updatedAt: new Date().toISOString() });
  const list = adapter.listModels;
  adapter.listModels = async (signal) => (await list(signal)).map((model) => ({ ...model, available: false, availabilityReason: "Restricted to the provider's application." }));
  const env = await fixture(t, adapter);
  const session = env.runtime.createSession({ ...config(env.project), freeOnly: true });
  const result = await env.runtime.run({ sessionId: session.id, goal: "Inspect project." });
  assert.equal(result.state, "WAITING_USER");
  assert.match(result.reason ?? "", /Restricted/);
  assert.equal(calls, 0);
});
