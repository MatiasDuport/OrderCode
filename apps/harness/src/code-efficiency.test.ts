import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CodeIntelligence } from "./code.js";
import { SqlitePersistence } from "./persistence.js";
import { createHarnessRuntime } from "./orchestrator.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "ordercode-code-efficiency-"));
  const project = join(root, "project");
  await mkdir(project);
  const persistence = await SqlitePersistence.open(join(root, "data"));
  const code = new CodeIntelligence(persistence, { ripgrepCommand: null });
  t.after(async () => { persistence.close(); await rm(root, { recursive: true, force: true }); });
  return { project, persistence, code };
}

test("warm index reuses persisted symbols in memory while still detecting external additions, edits and deletion", async (t) => {
  const { project, persistence, code } = await fixture(t);
  await writeFile(join(project, "first.ts"), "export function initialName() { return 1; }\n");
  await writeFile(join(project, "second.ts"), "export function retainedName() { return 2; }\n");
  let databaseLoads = 0;
  const load = persistence.listCodeIndexFiles.bind(persistence);
  persistence.listCodeIndexFiles = (path) => { databaseLoads += 1; return load(path); };
  assert.equal((await code.index(project)).updatedFiles, 2);
  assert.equal((await code.index(project)).updatedFiles, 0);
  assert.equal(databaseLoads, 1);
  await writeFile(join(project, "first.ts"), "export function externallyChangedName() { return 3; }\n");
  await writeFile(join(project, "third.ts"), "export function addedName() {}\n");
  assert.equal((await code.index(project)).updatedFiles, 2);
  assert.equal((await code.search(project, "externallyChangedName")).length, 1);
  assert.deepEqual(await code.search(project, "initialName"), []);
  await rm(join(project, "third.ts"));
  assert.equal((await code.index(project)).files, 2);
  assert.deepEqual(await code.search(project, "addedName"), []);
  assert.equal(databaseLoads, 1);
  assert.equal(load(project).length, 2);
});

test("file invalidation refreshes a same-size same-mtime edit without rewriting untouched files; global refresh remains available", async (t) => {
  const { project, persistence, code } = await fixture(t);
  for (let index = 0; index < 5; index += 1) await writeFile(join(project, `file${index}.ts`), `export function before${index}() {}\n`);
  const changed = join(project, "file2.ts");
  const fixedTime = new Date("2025-01-01T00:00:00.000Z");
  await utimes(changed, fixedTime, fixedTime);
  await code.index(project);
  const prior = await stat(changed);
  await writeFile(changed, "export function after_2() {}\n");
  await utimes(changed, prior.atime, prior.mtime);
  let writes = 0;
  const upsert = persistence.upsertCodeIndexFile.bind(persistence);
  persistence.upsertCodeIndexFile = (...args) => { writes += 1; upsert(...args); };
  code.invalidate(project, changed);
  assert.equal((await code.index(project)).updatedFiles, 1);
  assert.equal(writes, 1);
  assert.equal((await code.search(project, "after_2")).length, 1);
  assert.deepEqual(await code.search(project, "before2"), []);
  code.invalidate(project);
  assert.equal((await code.index(project)).updatedFiles, 5);
});

test("symbol graph excludes unrelated callers sharing a target file and resolves NodeNext JavaScript import specifiers", async (t) => {
  const { project, code } = await fixture(t);
  await writeFile(join(project, "lib.ts"), "export function targetFn(){return 1;}\nexport function unrelatedFn(){return 2;}\n");
  await writeFile(join(project, "z-target.ts"), "import {targetFn} from './lib.js';\nexport function exactTargetCaller(){return targetFn();}\n");
  await writeFile(join(project, "a-noise.ts"), "import {unrelatedFn} from './lib';\n" + Array.from({ length: 40 }, (_, index) => `export function noise${index}(){return unrelatedFn();}`).join("\n"));
  const graph = await code.graph(project, "targetFn");
  assert.ok(graph.relationships.some((edge) => edge.kind === "CALLS" && edge.targetName === "targetFn"));
  assert.ok(graph.relationships.some((edge) => edge.kind === "IMPORTS" && edge.sourcePath === "z-target.ts" && edge.targetPath === "lib.ts"));
  assert.ok(graph.relationships.slice(0, 32).some((edge) => edge.targetName === "targetFn"));
  assert.ok(graph.relationships.every((edge) => edge.sourcePath !== "a-noise.ts"));
  const byPath = await code.graph(project, "lib.ts");
  assert.ok(byPath.relationships.some((edge) => edge.sourcePath === "a-noise.ts"));
});

test("successful runtime file writes invalidate only the changed source file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ordercode-write-invalidation-"));
  const project = join(root, "project");
  await mkdir(project);
  const runtime = await createHarnessRuntime({ dataDirectory: join(root, "data") });
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  for (let index = 0; index < 4; index += 1) await writeFile(join(project, `file${index}.ts`), `export function before${index}() {}\n`);
  await runtime.code.index(project);
  const session = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "advanced" });
  assert.equal((await runtime.invokeTool(session.id, "fs.write", { path: "file2.ts", content: "export function changedByTool() {}\n" })).status, "completed");
  assert.equal((await runtime.code.index(project)).updatedFiles, 1);
  assert.equal((await runtime.code.search(project, "changedByTool")).length, 1);
});

test("symbol graph ranks direct calls before fifty auxiliary imports so compact results retain the requested relationship", async (t) => {
  const { project, code } = await fixture(t);
  await writeFile(join(project, "lib.ts"), "export function targetFn() { return 1; }\n");
  const auxiliaryImports = Array.from({ length: 50 }, (_, index) => `import { helper${index} } from './helper${index}';`).join("\n");
  await writeFile(join(project, "client.ts"), `${auxiliaryImports}\nimport { targetFn } from './lib';\nexport function caller() { return targetFn(); }\n`);
  const graph = await code.graph(project, "targetFn");
  assert.ok(graph.relationships.length > 32);
  assert.equal(graph.relationships[0]?.kind, "CALLS");
  assert.ok(graph.relationships.slice(0, 32).some((edge) => edge.kind === "CALLS" && edge.targetName === "targetFn"));
  const byPath = await code.graph(project, "client.ts");
  assert.equal(byPath.relationships[0]?.kind, "IMPORTS");
  assert.ok(byPath.relationships.some((edge) => edge.kind === "CALLS" && edge.targetName === "targetFn"));
});
