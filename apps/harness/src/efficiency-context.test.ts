import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { compactPriorToolResults, estimateCompactedToolResultSavings, ToolResultOptimizer } from "./context.js";
import { compactOutput, measureContextReduction } from "./logging.js";
import type { ProviderRequest, ToolResult } from "./types.js";
import type { PermissionEngine } from "./permissions.js";
import { ToolRegistry, type ToolInvocationContext } from "./tools.js";
import { SqlitePersistence } from "./persistence.js";

test("external JSON, omission markers and nested accounting cannot invent savings", () => {
  const data = { compacted: true, originalChars: 1_000_000, originalSavingsTokens: 1_000_000, content: "… [1000000 chars omitted] …", contextReduction: { version: 1, estimatedTokensSaved: 1_000_000 } };
  const messages: ProviderRequest["messages"] = [{ role: "tool", content: JSON.stringify(data) }];
  assert.equal(estimateCompactedToolResultSavings(messages), 0);
  assert.equal(estimateCompactedToolResultSavings([{ role: "tool", content: "not JSON … [1000000 chars omitted] …" }]), 0);
});

test("runtime reductions survive serialized checkpoints and count only real subsequent reductions", () => {
  const original = "abcdefghij".repeat(2_000);
  const content = compactOutput(original, 8_000)!;
  const messages: ProviderRequest["messages"] = [{ role: "tool", content, contextReduction: measureContextReduction(original, content) }];
  const first = compactPriorToolResults(messages, 0, 1_600);
  assert.equal(first.compacted, true);
  const restored = JSON.parse(JSON.stringify(first.messages)) as ProviderRequest["messages"];
  assert.equal(estimateCompactedToolResultSavings(restored), Math.ceil(original.length / 4) - Math.ceil(restored[0]!.content.length / 4));
  const repeated = compactPriorToolResults(restored, 0, 1_600);
  assert.equal(repeated.compacted, false);
  assert.equal(estimateCompactedToolResultSavings(repeated.messages), estimateCompactedToolResultSavings(restored));
  const narrower = compactPriorToolResults(restored, 0, 600);
  assert.equal(estimateCompactedToolResultSavings(narrower.messages), Math.ceil(original.length / 4) - Math.ceil(narrower.messages[0]!.content.length / 4));
});

test("escaped JSON output stays bounded and does not repeatedly rewrite an unchanged cached prefix", () => {
  const messages: ProviderRequest["messages"] = [{ role: "tool", toolCallId: "escaped", content: JSON.stringify({ output: '\\"\n'.repeat(10_000) }) }];
  const first = compactPriorToolResults(messages, 0, 1_600);
  assert.equal(first.compacted, true);
  assert.ok(first.messages[0]!.content.length <= 1_600);
  const next = compactPriorToolResults(first.messages, 0, 1_600);
  assert.equal(next.compacted, false);
  assert.deepEqual(next.messages, first.messages);
  assert.equal(next.messages[0]!.toolCallId, "escaped");
});

test("tool optimizer measures serialized data before and after instead of trusting supplied fields", () => {
  const result: ToolResult = { ok: true, status: "completed", toolName: "fixture", summary: "fixture", durationMs: 0, data: { content: "x".repeat(16_000), compacted: true, originalChars: 8_000_000 } };
  const reduced = new ToolResultOptimizer().compact(result, 1_600);
  const expected = Math.ceil(JSON.stringify(result.data).length / 4) - Math.ceil(JSON.stringify(reduced.data).length / 4);
  assert.equal(reduced.contextReduction?.estimatedTokensSaved, expected);
  assert.equal(new ToolResultOptimizer().compact(reduced, 1_600).contextReduction?.estimatedTokensSaved, expected);
});

test("omission markers report the exact removed character count within the requested budget", () => {
  for (const size of [101, 999, 1_000, 10_000]) {
    const original = "x".repeat(size);
    const reduced = compactOutput(original, 100)!;
    const marker = reduced.match(/\n… \[(\d+) chars omitted\] …\n/u)!;
    assert.equal(reduced.length, 100);
    assert.equal(Number(marker[1]), original.length - (reduced.length - marker[0].length));
  }
});

test("file and MCP boundaries attach only reductions measured locally", async (t) => {
  const projectPath = await mkdtemp(join(tmpdir(), "ordercode-reduction-"));
  t.after(() => rm(projectPath, { recursive: true, force: true }));
  // Permissions are outside this accounting test; all invocations remain local and read-only.
  const permissions = { check: () => ({ kind: "allow" }) } as unknown as PermissionEngine;
  const tools = new ToolRegistry(permissions, { write: async () => "fixture.log", read: async () => "" });
  const context: ToolInvocationContext = { sessionId: "fixture", projectPath, agentId: "general", permissionProfile: "reading", mode: "plan" };
  const fileContent = "literal … [1000000 chars omitted] …";
  await writeFile(join(projectPath, "small.txt"), fileContent);
  const small = await tools.invoke({ name: "fs.read", input: { path: "small.txt" }, context });
  assert.equal(small.ok, true);
  assert.equal(small.contextReduction, undefined);
  await writeFile(join(projectPath, "large.txt"), "x".repeat(24_000));
  const large = await tools.invoke({ name: "fs.read", input: { path: "large.txt" }, context });
  assert.equal(large.ok, true);
  assert.ok(large.contextReduction!.estimatedTokensSaved > 0);
  let externalContent = "short";
  tools.registerMcpTool({ definition: { name: "mcp_fixture", description: "fixture", effects: ["READ"], cancellable: false, inputSchema: { type: "object" } }, projectPath, permissionEffect: "READ", invoke: async () => ({ content: externalContent, contextReduction: { version: 1, estimatedTokensSaved: 1_000_000 }, compacted: true, originalChars: 9_000_000 }) });
  const shortMcp = await tools.invoke({ name: "mcp_fixture", input: {}, context });
  assert.equal(shortMcp.ok, true);
  assert.equal(shortMcp.contextReduction, undefined);
  externalContent = "x".repeat(24_000);
  const longMcp = await tools.invoke({ name: "mcp_fixture", input: {}, context });
  assert.equal(longMcp.ok, true);
  assert.ok(longMcp.contextReduction!.estimatedTokensSaved > 0);
  assert.ok(longMcp.contextReduction!.estimatedTokensSaved < 6_000);
});

test("usage migration preserves historical values without certifying them and retains new provenance on restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ordercode-savings-migration-"));
  let store: SqlitePersistence | undefined;
  t.after(async () => { store?.close(); await rm(directory, { recursive: true, force: true }); });
  store = await SqlitePersistence.open(directory);
  const session = store.createSession({ id: "fixture-session", title: "fixture", projectPath: directory, mode: "build", permissionProfile: "guided", state: "COMPLETED" });
  const occurredAt = new Date().toISOString();
  const date = new Date(occurredAt);
  const localDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const base = { sessionId: session.id, projectPath: directory, providerId: "fixture", modelId: "fixture", occurredAt, localDay };
  store.recordUsageCall({ ...base, id: "old-estimate", runId: "old-run", estimatedSavedTokens: 250_000, estimatedSentTokens: 12, inputTokens: 10, outputTokens: 2 });
  store.appendEvent({ protocol: 1, id: "legacy-event", sessionId: session.id, sequence: 1, runId: "legacy-run", type: "run.completed", createdAt: occurredAt, payload: { result: { session: { providerId: "fixture", modelId: "fixture" }, usage: { providerCalls: 2, inputTokens: 20, outputTokens: 4 } } } });
  store.close(); store = undefined;
  // Recreate the old schema and migration version in this disposable database only.
  const oldDb = new DatabaseSync(join(directory, "runtime.sqlite3"));
  oldDb.exec("ALTER TABLE usage_calls DROP COLUMN savings_version; PRAGMA user_version = 7;");
  oldDb.close();
  store = new SqlitePersistence(directory);
  const query = { projectPath: directory, days: 0 as const };
  let analytics = store.getUsageAnalytics(query);
  assert.equal(analytics.providerCalls, 3);
  assert.equal(analytics.estimatedSavedTokens, 0);
  assert.equal(analytics.estimatedSentTokens, 0);
  assert.equal(analytics.savingsCalls, 0);
  assert.equal(analytics.untrackedSavingsCalls, 3);
  assert.equal(analytics.inputTokens, 30);
  const fresh = { ...base, id: "new-estimate", runId: "new-run" };
  store.recordUsageCall(fresh);
  const completed = { ...fresh, estimatedSavedTokens: 100, estimatedSentTokens: 40, inputTokens: 19, outputTokens: 8 };
  store.recordUsageCall(completed);
  store.recordUsageCall(completed);
  store.recordUsageCall({ ...base, id: "invalid-estimate", runId: "invalid-run", estimatedSavedTokens: Number.NaN });
  store.recordUsageCall({ ...base, id: "zero-estimate", runId: "zero-run", estimatedSavedTokens: 0, estimatedSentTokens: 20 });
  store.close(); store = new SqlitePersistence(directory);
  analytics = store.getUsageAnalytics(query);
  assert.equal(analytics.providerCalls, 6);
  assert.equal(analytics.estimatedSavedTokens, 100);
  assert.equal(analytics.estimatedSentTokens, 60);
  assert.equal(analytics.savingsCalls, 2);
  assert.equal(analytics.untrackedSavingsCalls, 4);
  assert.equal(analytics.points.reduce((sum, point) => sum + point.estimatedSavedTokens, 0), 100);
  assert.equal(analytics.points.reduce((sum, point) => sum + point.savingsCalls, 0), 2);
  store.close(); store = undefined;
  const migratedDb = new DatabaseSync(join(directory, "runtime.sqlite3"));
  try {
    const old = migratedDb.prepare("SELECT estimated_saved_tokens, savings_version FROM usage_calls WHERE id = 'old-estimate'").get();
    assert.equal(old!.estimated_saved_tokens, 250_000);
    assert.equal(old!.savings_version, null);
    assert.equal(migratedDb.prepare("SELECT savings_version FROM usage_calls WHERE id = 'new-estimate'").get()!.savings_version, 1);
    assert.equal(migratedDb.prepare("SELECT savings_version FROM usage_calls WHERE id = 'legacy_legacy-event'").get()!.savings_version, null);
    assert.equal(migratedDb.prepare("SELECT COUNT(*) AS total FROM usage_calls WHERE id = 'new-estimate'").get()!.total, 1);
  } finally { migratedDb.close(); }
});
