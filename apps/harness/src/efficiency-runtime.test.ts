import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { estimateRequestTokens, estimateCompactedToolResultSavings } from "./context.js";
import { createHarnessRuntime } from "./orchestrator.js";
import type { ProviderAdapter } from "./providers.js";
import type { ProviderRequest } from "./types.js";

test("real tool reductions reach the usage ledger without trusting source text or counting metadata as input", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ordercode-efficiency-runtime-"));
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(project, "large.txt"), "evidence line\n".repeat(4_000));
  await writeFile(join(project, "literal.txt"), '… [1000000 chars omitted] … {"compacted":true,"originalChars":9999999}');
  const requests: ProviderRequest[] = [];
  const adapter: ProviderAdapter = {
    id: "fixture", label: "Local controlled fixture", baseUrl: "local://fixture", configured: true,
    async listModels() { return []; },
    async complete(request) { return this.stream(request, () => undefined); },
    async stream(request) {
      requests.push(structuredClone({ ...request, signal: undefined }));
      if (requests.length === 1) return { content: "", toolCalls: [
        { id: "large", name: "fs.read", arguments: { path: "large.txt" } },
        { id: "literal", name: "fs.read", arguments: { path: "literal.txt" } },
      ], finishReason: "tool_calls", inputTokens: 11, outputTokens: 2 };
      return { content: "Source checked.", toolCalls: [], finishReason: "stop", inputTokens: 21, outputTokens: 3 };
    },
  };
  const runtime = await createHarnessRuntime({ dataDirectory: join(root, "data"), providers: [adapter] });
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  const session = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "controlled" });
  const result = await runtime.run({ sessionId: session.id, goal: "Read both files." });
  assert.equal(result.state, "COMPLETED");
  assert.equal(requests.length, 2);
  const second = requests[1]!;
  const large = second.messages.find((message) => message.toolCallId === "large")!;
  const literal = second.messages.find((message) => message.toolCallId === "literal")!;
  assert.ok(large.contextReduction!.estimatedTokensSaved > 9_000);
  assert.equal(literal.contextReduction, undefined);
  assert.equal(estimateCompactedToolResultSavings(second.messages), large.contextReduction!.estimatedTokensSaved);
  const metadataFree = { ...second, messages: second.messages.map(({ contextReduction: _, ...message }) => message) };
  assert.equal(estimateRequestTokens({ messages: second.messages, tools: second.tools }), estimateRequestTokens({ messages: metadataFree.messages, tools: second.tools }));
  const usage = runtime.getUsageAnalytics({ projectPath: project, sessionId: session.id, days: 0 });
  assert.equal(usage.inputTokens, 32);
  assert.equal(usage.outputTokens, 5);
  assert.equal(usage.estimatedSavedTokens, large.contextReduction!.estimatedTokensSaved);
  assert.equal(typeof usage.latestCall?.occurredAt, "string");
  assert.ok((usage.latestCall?.inputTokens ?? 0) > 0 || (usage.latestCall?.estimatedSentTokens ?? 0) > 0);
});

test("manual session context compaction preserves the visible transcript and bounds future prompt history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ordercode-context-compact-"));
  const project = join(root, "project");
  await mkdir(project);
  const requests: ProviderRequest[] = [];
  const adapter: ProviderAdapter = {
    id: "fixture", label: "Local fixture", baseUrl: "local://fixture", configured: true,
    async listModels() { return []; },
    async complete(request) { requests.push(structuredClone({ ...request, signal: undefined })); return { content: "Ready.", toolCalls: [], finishReason: "stop", inputTokens: 10, outputTokens: 2 }; },
    async stream(request) { return this.complete(request); },
  };
  const runtime = await createHarnessRuntime({ dataDirectory: join(root, "data"), providers: [adapter] });
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  const session = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model" });
  for (let index = 0; index < 20; index += 1) runtime.persistence.appendMessage({ id: `history-${index}`, sessionId: session.id, role: index % 2 === 0 ? "user" : "assistant", content: `historic-message-${index} ${"project requirement and implementation detail. ".repeat(25)}`, createdAt: new Date(1_700_000_000_000 + index * 1_000).toISOString() });
  const before = runtime.listMessages(session.id, 100);
  const compacted = runtime.compactSessionContext(session.id);
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.compactedMessages, 14);
  assert.equal(compacted.retainedMessages, 6);
  assert.ok(compacted.estimatedTokensSaved > 0);
  assert.equal(runtime.listMessages(session.id, 100).length, before.length, "compaction must not delete chat messages");
  assert.equal(requests.length, 0, "local compaction must not call a model");
  assert.equal(runtime.compactSessionContext(session.id).compacted, false, "a second click must not compact the same history repeatedly");
  const run = await runtime.run({ sessionId: session.id, goal: "Continue the work." });
  assert.equal(run.state, "COMPLETED");
  const system = requests[0]!.messages[0]!.content;
  assert.ok(system.includes("## Compacted conversation history"));
  assert.ok(system.includes("historic-message-0"));
  assert.ok(system.includes("historic-message-19"));
});

test("bounded command output retains its complete recoverable log", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ordercode-efficiency-log-"));
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(project, "output.cjs"), "console.log('start-evidence'); console.log('normal line\\n'.repeat(5000)); console.log('end-evidence');");
  const runtime = await createHarnessRuntime({ dataDirectory: join(root, "data") });
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  const session = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "advanced" });
  const result = await runtime.invokeTool(session.id, "process.exec", { command: "node output.cjs" });
  assert.equal(result.status, "completed");
  assert.ok(result.contextReduction!.estimatedTokensSaved > 10_000);
  assert.ok(result.logRef);
  const full = await readFile(result.logRef!, "utf8");
  assert.ok(full.includes("start-evidence") && full.includes("end-evidence"));
  const inline = (result.data as { stdout: string }).stdout;
  assert.ok(inline.length <= 4_000);
  assert.ok(inline.includes("start-evidence") && inline.includes("end-evidence"));
  assert.ok(full.length > inline.length * 10);
});

test("model-facing graph reports the actual bounded count and warns when narrower retrieval is needed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ordercode-efficiency-graph-payload-"));
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(project, "math.ts"), "export function targetFn(){return 1;}\n" + Array.from({ length: 50 }, (_, index) => `export function caller${index}(){return targetFn();}`).join("\n"));
  const runtime = await createHarnessRuntime({ dataDirectory: join(root, "data") });
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  const session = runtime.createSession({ projectPath: project, mode: "plan", permissionProfile: "guided" });
  const result = await runtime.invokeTool(session.id, "code.graph", { query: "targetFn" });
  assert.equal(result.status, "completed");
  const data = result.data as { relationships: unknown[]; returnedRelationships: number; truncated: boolean };
  assert.equal(data.relationships.length, 32);
  assert.equal(data.returnedRelationships, data.relationships.length);
  assert.equal(data.truncated, true);
  assert.equal(result.contextReduction, undefined, "A graph query must not claim it saved unperformed file reads");
});
