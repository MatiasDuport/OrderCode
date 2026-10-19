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

test("continuous completion guides the model through verification without changing permissions or budgets", async (t) => {
  let calls = 0;
  const instructions: string[] = [];
  const env = await fixture(t, provider(async (request) => {
    const system = request.messages.find((message) => message.role === "system")?.content;
    if (typeof system === "string") instructions.push(system);
    if (calls++ === 0) return { content: "Applying the verified change.", finishReason: "tool_calls", toolCalls: [{ id: "write-result", name: "fs.write", arguments: { path: "result.txt", content: "verified" } }] };
    return done();
  }));
  const session = env.runtime.createSession(config(env.project));
  const continuous = await env.runtime.run({ sessionId: session.id, goal: "Complete and verify the requested change.", continueUntilDone: true });
  assert.equal(continuous.state, "WAITING_APPROVAL", "continuous mode must still wait for write approval");
  assert.ok(continuous.pendingPermission);
  assert.equal((env.runtime.persistence.getCheckpoint(session.id) as { continueUntilDone?: boolean }).continueUntilDone, true);
  const resumed = await env.runtime.resolvePermission(continuous.pendingPermission.id, "once");
  assert.ok("state" in resumed);
  assert.equal(resumed.state, "COMPLETED");
  assert.equal(resumed.usage.toolCalls, 1);
  assert.equal(await readFile(join(env.project, "result.txt"), "utf8"), "verified");
  assert.equal(instructions.length, 2);
  assert.ok(instructions.every((text) => text.includes("continuous completion") && text.includes("configured limits")));
  const resumedStates = env.runtime.listEvents(session.id).filter((event) => event.type === "session.state" && event.payload.state === "RUNNING");
  assert.ok(resumedStates.some((event) => event.payload.resumedAfterApproval === continuous.pendingPermission!.id));
  assert.ok(resumedStates.every((event) => event.payload.continueUntilDone === true));
  assert.equal(env.runtime.getSession(session.id).permissionProfile, "guided");
  assert.equal(env.runtime.getSession(session.id).budget?.maxDurationMs, null);
  assert.equal(env.runtime.getSession(session.id).budget?.maxToolCalls, null);

  instructions.length = 0;
  const standard = await env.runtime.run({ sessionId: session.id, goal: "Answer briefly.", continueUntilDone: false });
  assert.equal(standard.state, "COMPLETED");
  assert.equal(instructions.length, 1);
  assert.ok(!instructions[0]?.includes("continuous completion"));
});

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

test("invalid required tool arguments are reported to the model so it can recover", async (t) => {
  let calls = 0;
  const env = await fixture(t, provider(async (request) => {
    if (calls++ === 0) return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "read-without-path", name: "fs.read", arguments: {} }] };
    const toolResult = request.messages.find((message) => message.role === "tool");
    assert.equal(toolResult?.toolCallId, "read-without-path");
    assert.match(toolResult?.content ?? "", /path is required/);
    return done();
  }));
  const session = env.runtime.createSession(config(env.project));
  const result = await env.runtime.run({ sessionId: session.id, goal: "Edit a requested phrase." });
  assert.equal(result.state, "COMPLETED");
  assert.equal(calls, 2);
  assert.equal(result.toolResults[0]?.status, "failed");
  const events = env.runtime.listEvents(session.id).filter((event) => event.type === "tool.started" || event.type === "tool.completed");
  assert.equal(events.filter((event) => event.type === "tool.started" && event.payload.toolName === "fs.read").length, 1);
  assert.equal(events.filter((event) => event.type === "tool.completed" && event.payload.toolName === "fs.read").length, 1);
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
  const session = env.runtime.createSession({ ...config(env.project), permissionProfile: "auto" });
  const result = await env.runtime.invokeTool(session.id, "process.exec", { command: "Get-ChildItem -Name source.txt | Select-Object -First 1" });
  assert.equal(result.status, "completed", result.summary);
  assert.equal((result.data as { stdout: string }).stdout.trim(), "source.txt");
});

test("Auto permissions run bounded local inspection in Build and Auto, while Plan and risky commands stay gated", async (t) => {
  const env = await fixture(t, provider(async () => done()));
  for (const mode of ["build", "auto"] as const) {
    const session = env.runtime.createSession({ ...config(env.project), mode, permissionProfile: "auto" });
    const version = await env.runtime.invokeTool(session.id, "process.exec", { command: "node --version" });
    assert.equal(version.status, "completed", `${mode}: ${version.summary}`);
    assert.match((version.data as { stdout: string }).stdout, /^v?\d/);

    const write = await env.runtime.invokeTool(session.id, "fs.write", { path: `auto-${mode}.txt`, content: "written without prompt" });
    assert.equal(write.status, "completed", `${mode}: safe workspace writes should use the Auto profile`);

    const risky = await env.runtime.invokeTool(session.id, "process.exec", { command: 'node -e "process.stdout.write(\'approval required\')"' });
    assert.equal(risky.status, "rejected", `${mode}: arbitrary code execution must not run under Auto`);
    assert.ok((risky.data as { permissionRequest?: unknown }).permissionRequest);
  }

  const plan = env.runtime.createSession({ ...config(env.project), mode: "plan", permissionProfile: "auto" });
  const blockedWrite = await env.runtime.invokeTool(plan.id, "fs.write", { path: "plan-write.txt", content: "blocked" });
  assert.equal(blockedWrite.status, "rejected");
  assert.equal((blockedWrite.data as { permissionRequest?: unknown }).permissionRequest, undefined, "Plan mode must hard-block writes instead of asking for approval");
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
    if (efforts.length === 1) return { ...done(), toolCalls: [{ id: "delegate-1", name: "agents.delegate", arguments: { agentId: "review", task: "Review supplied context", context: "The project has one source file." } }], finishReason: "tool_calls" };
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

test("custom agents use configured tools, delegate within depth, inherit the selected model, and report lifecycle", async (t) => {
  const requests: ProviderRequest[] = [];
  let customAgentId = "";
  const adapter = provider(async (request) => {
    requests.push(request);
    const user = request.messages.findLast((message) => message.role === "user")?.content ?? "";
    const toolsUsed = request.messages.filter((message) => message.role === "tool");
    if (user.includes("nested-agent-smoke-root") && !toolsUsed.length) {
      const delegate = request.tools?.find((tool) => tool.name === "agents.delegate");
      const properties = delegate?.inputSchema.properties as { agentId?: { enum?: string[] } } | undefined;
      assert.ok(properties?.agentId?.enum?.includes(customAgentId));
      return { ...done(), finishReason: "tool_calls", toolCalls: [{ id: "delegate-custom", name: "agents.delegate", arguments: { agentId: customAgentId, task: "nested-agent-smoke-custom" } }] };
    }
    if (user.includes("nested-agent-smoke-custom")) {
      const customSystem = request.messages.find((message) => message.role === "system")?.content ?? "";
      assert.match(customSystem, /Research Guide/);
      assert.doesNotMatch(customSystem, /Unselected Skill/);
      if (!toolsUsed.length) {
        assert.ok(request.tools?.some((tool) => tool.name === "fs.read"));
        assert.ok(request.tools?.some((tool) => tool.name === "agents.delegate"));
        return { ...done(), finishReason: "tool_calls", toolCalls: [{ id: "custom-read", name: "fs.read", arguments: { path: "source.txt" } }] };
      }
      if (!toolsUsed.some((message) => message.toolName === "agents.delegate")) {
        assert.ok(toolsUsed.some((message) => message.toolName === "fs.read"));
        return { ...done(), finishReason: "tool_calls", toolCalls: [{ id: "delegate-review", name: "agents.delegate", arguments: { agentId: "review", task: "nested-agent-smoke-review" } }] };
      }
      return { ...done(), content: "Custom agent integrated the reviewer evidence." };
    }
    if (user.includes("nested-agent-smoke-review")) {
      assert.equal(request.model, "fixture-model");
      assert.equal(request.reasoningEffort, "high");
      assert.ok(request.tools?.some((tool) => tool.name === "fs.read"));
      assert.ok(request.tools?.every((tool) => tool.effects.every((effect) => effect === "READ")));
      assert.ok(request.tools?.some((tool) => tool.name === "agents.delegate"), "the configured second delegation level should be available");
      if (!toolsUsed.length) return { ...done(), finishReason: "tool_calls", toolCalls: [{ id: "delegate-security", name: "agents.delegate", arguments: { agentId: "security", task: "nested-agent-smoke-security" } }] };
      return { ...done(), content: "Reviewer integrated QA evidence and confirmed the source." };
    }
    if (user.includes("nested-agent-smoke-security")) {
      assert.equal(request.model, "fixture-model");
      assert.ok(request.tools?.every((tool) => tool.effects.every((effect) => effect === "READ")));
      assert.ok(!request.tools?.some((tool) => tool.name === "agents.delegate"), "the configured delegation depth must stop at level three");
      return { ...done(), content: "QA found no issue in the supplied evidence." };
    }
    return done();
  });
  const list = adapter.listModels;
  adapter.listModels = async (signal) => (await list(signal)).map((model) => ({ ...model, reasoningEfforts: ["high"] }));
  const env = await fixture(t, adapter);
  const selectedSkill = ".agents/skills/research/SKILL.md", otherSkill = ".agents/skills/other/SKILL.md";
  await mkdir(join(env.project, ".agents/skills/research"), { recursive: true });
  await mkdir(join(env.project, ".agents/skills/other"), { recursive: true });
  await writeFile(join(env.project, selectedSkill), "---\nname: Research Guide\n---\nUse project evidence.");
  await writeFile(join(env.project, otherSkill), "---\nname: Unselected Skill\n---\nDo not include this skill.");
  await env.runtime.skills.setEnabled(env.project, selectedSkill, true);
  await env.runtime.skills.setEnabled(env.project, otherSkill, true);
  const profile = env.runtime.agents.save({ name: "Researcher", description: "Inspect source and verify evidence", instructions: "Read relevant project evidence and report it.", toolAllowlist: ["fs.read"], skillAllowlist: [selectedSkill], enabled: true, templateId: "research", outcome: "Evidence-based result", autoAssign: true, canDelegate: true, delegateAllowlist: ["review"], delegationDepth: 2 });
  customAgentId = profile.id;
  const session = env.runtime.createSession({ ...config(env.project), reasoningEffort: "high" });
  const result = await env.runtime.run({ sessionId: session.id, goal: "nested-agent-smoke-root", agentId: "build" });
  assert.equal(result.state, "COMPLETED", JSON.stringify({ reason: result.reason, toolResults: result.toolResults.map((item) => ({ status: item.status, summary: item.summary, diagnostics: item.diagnostics, data: item.data })) }));
  assert.equal(result.usage.providerCalls, 8);
  assert.equal(result.usage.toolCalls, 4);
  assert.equal(requests.length, 8);
  assert.ok(requests.every((request) => request.model === "fixture-model"));
  const lifecycle = env.runtime.listEvents(session.id).filter((event) => event.type.startsWith("agent."));
  const started = lifecycle.filter((event) => event.type === "agent.started");
  assert.equal(started.length, 3);
  const custom = started.find((event) => event.payload.agentId === profile.id)!;
  const review = started.find((event) => event.payload.agentId === "review")!;
  const security = started.find((event) => event.payload.agentId === "security")!;
  assert.equal(review.payload.parentAgentRunId, custom.payload.agentRunId);
  assert.equal(review.payload.depth, 2);
  assert.equal(security.payload.parentAgentRunId, review.payload.agentRunId);
  assert.equal(security.payload.depth, 3);
  assert.equal(lifecycle.filter((event) => event.type === "agent.completed" && event.payload.state === "COMPLETED").length, 3);
  assert.ok(env.runtime.listEvents(session.id).some((event) => event.type === "tool.started" && event.payload.agentId === profile.id && event.payload.agentRunId === custom.payload.agentRunId));
});

test("the default General selection routes matching tasks to opted-in custom profiles", async (t) => {
  let selectedTools: string[] = [];
  const env = await fixture(t, provider(async (request) => {
    selectedTools = request.tools?.map((tool) => tool.name) ?? [];
    assert.match(request.messages[0]?.content ?? "", /Regression researcher/);
    assert.ok(request.tools?.every((tool) => tool.effects.every((effect) => effect === "READ")));
    return done();
  }));
  const profile = env.runtime.agents.save({ name: "Regression researcher", description: "Review source code for regressions", instructions: "Inspect evidence before reporting.", toolAllowlist: ["fs.read"], enabled: true, autoAssign: true, canDelegate: false });
  const session = env.runtime.createSession(config(env.project));
  const result = await env.runtime.run({ sessionId: session.id, goal: "Review source code for a regression", agentId: "general" });
  assert.equal(result.state, "COMPLETED");
  assert.deepEqual(selectedTools, ["fs.read"]);
  assert.ok(env.runtime.listEvents(session.id).some((event) => event.type === "session.state" && event.payload.state === "PREPARING" && event.payload.agentId === profile.id));
});

test("delegated writes wait for the user's permission and resume without a root-run checkpoint", { timeout: 15_000 }, async (t) => {
  let writerAgentId = "";
  const adapter = provider(async (request) => {
    const user = request.messages.findLast((message) => message.role === "user")?.content ?? "";
    const toolResults = request.messages.filter((message) => message.role === "tool");
    if (user.includes("delegated-write-root") && !toolResults.length) return { ...done(), finishReason: "tool_calls", toolCalls: [{ id: "delegate-writer", name: "agents.delegate", arguments: { agentId: writerAgentId, task: "delegated-write-child" } }] };
    if (user.includes("delegated-write-child") && !toolResults.length) return { ...done(), finishReason: "tool_calls", toolCalls: [{ id: "write-from-agent", name: "fs.write", arguments: { path: "delegated.txt", content: "approved by the user" } }] };
    return done();
  });
  const env = await fixture(t, adapter);
  const profile = env.runtime.agents.save({ name: "Writer", description: "Make requested project changes", instructions: "Write only the requested file.", toolAllowlist: ["fs.write"], enabled: true, autoAssign: true, canDelegate: false });
  writerAgentId = profile.id;
  const session = env.runtime.createSession(config(env.project));
  const running = env.runtime.run({ sessionId: session.id, goal: "delegated-write-root", agentId: "build" });
  let request: { id: string } | undefined;
  for (let attempt = 0; attempt < 200 && !request; attempt++) {
    await delay(10);
    const event = env.runtime.listEvents(session.id).findLast((item) => item.type === "permission.requested" && item.payload.agentId === writerAgentId);
    const pending = event?.payload.request;
    if (pending && typeof pending === "object" && typeof (pending as { id?: unknown }).id === "string") request = pending as { id: string };
  }
  assert.ok(request, `delegated file write should request the same session permission as a primary-agent write; events: ${JSON.stringify(env.runtime.listEvents(session.id).map((event) => ({ type: event.type, payload: event.payload })))}`);
  const resolved = await env.runtime.resolvePermission(request.id, "once");
  assert.ok("ok" in resolved && resolved.ok);
  const result = await running;
  assert.equal(result.state, "COMPLETED");
  assert.equal(await readFile(join(env.project, "delegated.txt"), "utf8"), "approved by the user");
  assert.equal(env.runtime.getSession(session.id).state, "COMPLETED");
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
