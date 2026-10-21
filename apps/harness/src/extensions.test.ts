import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { createHarnessRuntime } from "./orchestrator.js";
import { JsonRpcServer } from "./rpc.js";
import { resolveMcpExecutable, resolveMcpLaunch } from "./mcp.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "ordercode-extensions-"));
  const project = join(root, "project"); await mkdir(project);
  const runtime = await createHarnessRuntime({ dataDirectory: join(root, "data"), providers: [] });
  const session = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided" });
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  return { root, project, runtime, session, rpc: new JsonRpcServer(runtime) };
}

test("offline UI catalog is available without a workspace and model tools cannot install extensions", async (t) => {
  const { runtime, rpc } = await fixture(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Catalog must not access network"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await rpc.handle({ jsonrpc: "2.0", id: 1, method: "extensions.catalog" });
  assert.equal(response?.error, undefined);
  const catalog = response?.result as Awaited<ReturnType<typeof runtime.extensions.list>>;
  assert.equal(catalog.length, 11);
  assert.equal(catalog.filter((entry) => entry.kind === "skill").length, 6);
  assert.ok(catalog.every((entry) => !entry.installed && !entry.enabled && !entry.connected && entry.sourceUrl.startsWith("https://")));
  assert.ok(runtime.tools.list().every((tool) => !tool.name.startsWith("extensions.")));
});

test("explicit install writes and activates bundled skills offline, is idempotent, and leaves no pending grants", async (t) => {
  const { runtime, session, project } = await fixture(t);
  await assert.rejects(runtime.extensions.install(session.id, "skill:debug", false), /explícita/);
  await assert.rejects(runtime.extensions.install(session.id, "skill:unknown", true), /catálogo/);
  const first = await runtime.extensions.install(session.id, "skill:debug", true);
  assert.equal(first.status, "ready"); assert.equal(first.entry.enabled, true);
  const content = await readFile(join(project, first.entry.skillId!), "utf8");
  assert.match(content, /license: Apache-2.0/);
  assert.match(content, /solo cuando la tarea/);
  const second = await runtime.extensions.install(session.id, "skill:debug", true);
  assert.deepEqual(second, first);
  assert.equal((await runtime.skills.list(project)).length, 1);
  assert.equal((await runtime.skills.list(project))[0]?.name, "Depuración con evidencia");
  assert.match(await runtime.skills.activeInstructions(project), /Depuración con evidencia/);
  assert.deepEqual(runtime.permissions.getPending(session.id), []);
  assert.equal(runtime.getSession(session.id).permissionProfile, "guided");
  // The one-off installation grant must not authorize a later WRITE.
  const unrelated = runtime.permissions.check("guided", { sessionId: session.id, projectPath: project, agentId: "general", toolName: "fs.write", action: "write", effect: "WRITE", path: join(project, "other.txt") });
  assert.equal(unrelated.kind, "approval");
  runtime.permissions.resolve(unrelated.request.id, "reject");
});

test("catalog reactivation preserves edited bundled content and displays a human name while retaining the stable slug", async (t) => {
  const { runtime, session, project } = await fixture(t);
  const installed = await runtime.extensions.install(session.id, "skill:web-design", true);
  const file = join(project, installed.entry.skillId!);
  const original = await readFile(file, "utf8");
  assert.match(original, /name: ordercode-web-design\n/);
  assert.match(original, /display-name: Diseño web\n/);
  assert.match(original, /catalog-id: skill:web-design\n/);
  const customized = `${original}\nInstrucción propia del usuario: usa la cuadrícula de ocho puntos.\n`;
  await writeFile(file, customized);
  await runtime.skills.setEnabled(project, installed.entry.skillId!, false);
  assert.equal((await runtime.extensions.list(session.id)).find((entry) => entry.id === "skill:web-design")?.enabled, false);
  const reactivated = await runtime.extensions.install(session.id, "skill:web-design", true);
  assert.equal(reactivated.status, "ready"); assert.equal(reactivated.entry.enabled, true);
  assert.equal(await readFile(file, "utf8"), customized);
  assert.equal((await runtime.skills.list(project))[0]?.name, "Diseño web");
  assert.match(await runtime.skills.activeInstructions(project), /### Diseño web\n/);
  assert.deepEqual(runtime.permissions.getPending(), []);
});

test("Plan, Reading and explicit rejecting rules block exact installation before any write or connection", async (t) => {
  const { runtime, session, project } = await fixture(t);
  runtime.updateSession(session.id, { mode: "plan" });
  await assert.rejects(runtime.extensions.install(session.id, "skill:debug", true), /Plan mode/);
  runtime.updateSession(session.id, { mode: "build", permissionProfile: "reading" });
  await assert.rejects(runtime.extensions.install(session.id, "mcp:deepwiki", true), /reading profile/);
  runtime.updateSession(session.id, { permissionProfile: "guided" });
  runtime.persistence.addPermissionRule({ id: "reject-extension", decision: "reject", projectPath: project, toolName: "extensions.install", effect: "WRITE", resource: "skill:debug" });
  await assert.rejects(runtime.extensions.install(session.id, "skill:debug", true), /rejects/);
  runtime.persistence.addPermissionRule({ id: "reject-network", decision: "reject", projectPath: project, toolName: "extensions.install", effect: "NETWORK", resource: "mcp:deepwiki" });
  await assert.rejects(runtime.extensions.install(session.id, "mcp:deepwiki", true), /rejects/);
  assert.equal(runtime.mcp.list(project).length, 0);
  assert.ok((await runtime.extensions.list(session.id)).every((entry) => !entry.installed));
  assert.deepEqual(runtime.permissions.getPending(), []);
});

test("bundled installation preserves user files and rejects symlink directory escapes", async (t) => {
  const { runtime, session, project, root } = await fixture(t);
  const destination = join(project, ".agents/skills/ordercode-debug/SKILL.md");
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, "User content");
  await assert.rejects(runtime.extensions.install(session.id, "skill:debug", true), /preserved/);
  assert.equal(await readFile(destination, "utf8"), "User content");
  const outside = join(root, "outside"); await mkdir(outside);
  await symlink(outside, join(project, ".agents/skills/ordercode-web-design"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(runtime.extensions.install(session.id, "skill:web-design", true), /symbolic links|outside/);
  assert.deepEqual(runtime.permissions.getPending(), []);
});

test("installation rechecks the current session at the actual write after asynchronous inspection", async (t) => {
  const { runtime, session, project } = await fixture(t);
  const originalList = runtime.skills.list.bind(runtime.skills);
  let changed = false;
  runtime.skills.list = async (path) => {
    const result = await originalList(path);
    if (!changed) { changed = true; runtime.updateSession(session.id, { mode: "plan" }); }
    return result;
  };
  await assert.rejects(runtime.extensions.install(session.id, "skill:debug", true), /Plan mode/);
  await assert.rejects(readFile(join(project, ".agents/skills/ordercode-debug/SKILL.md")), { code: "ENOENT" });
  assert.deepEqual(runtime.permissions.getPending(), []);
});

test("concurrent activation and installs preserve every selection and enforce the twelve-skill cap", async (t) => {
  const { runtime, session, project } = await fixture(t);
  const ids = (await runtime.extensions.list()).filter((entry) => entry.kind === "skill").map((entry) => entry.id);
  const manual = Array.from({ length: 7 }, (_, index) => `.agents/skills/manual-${index}/SKILL.md`);
  for (const id of manual) { await mkdir(dirname(join(project, id)), { recursive: true }); await writeFile(join(project, id), `---\nname: ${id}\n---\nManual guidance`); }
  const outcomes = await Promise.allSettled([...ids.map((id) => runtime.extensions.install(session.id, id, true)), ...manual.map((id) => runtime.skills.setEnabled(project, id, true))]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 12);
  assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await runtime.skills.list(project)).filter((skill) => skill.enabled).length, 12);
  const toDisable = (await runtime.skills.list(project)).filter((skill) => skill.enabled).slice(0, 2);
  await Promise.all(toDisable.map((skill) => runtime.skills.setEnabled(project, skill.id, false)));
  assert.equal((await runtime.skills.list(project)).filter((skill) => skill.enabled).length, 10);
});

test("MCP installation performs a real stateful HTTP handshake and discovery, reuses endpoints and reflects deletion", async (t) => {
  const { runtime, session, project } = await fixture(t);
  let initialized = 0; let listed = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") { response.writeHead(405).end(); return; }
    let body = ""; for await (const chunk of request) body += String(chunk);
    const rpc = JSON.parse(body) as { id?: string | number; method: string; params?: { protocolVersion?: string } };
    if (rpc.method !== "initialize" && request.headers["mcp-session-id"] !== "fixture-session") { response.writeHead(400).end("Missing session"); return; }
    if (rpc.id === undefined) { response.writeHead(202).end(); return; }
    response.setHeader("Content-Type", "application/json");
    if (rpc.method === "initialize") {
      initialized++; response.setHeader("Mcp-Session-Id", "fixture-session");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Local catalog fixture", version: "1.0.0" } } }));
    } else if (rpc.method === "tools/list") {
      listed++; response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "search_docs", description: "Local fixture documentation", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] } }));
    } else response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Unknown method" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.equal(new URL(url).origin, "https://mcp.deepwiki.com");
    return originalFetch(`http://127.0.0.1:${address.port}/mcp`, init);
  };
  t.after(async () => { await runtime.mcp.close(); globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const existing = await runtime.mcp.save({ projectPath: project, name: "Existing DeepWiki", transport: "streamable-http", endpoint: "https://mcp.deepwiki.com/mcp/", args: [], secretKeys: [], enabled: false });
  const installed = await runtime.extensions.install(session.id, "mcp:deepwiki", true);
  assert.equal(installed.status, "ready"); assert.equal(installed.entry.connected, true); assert.equal(installed.entry.serverId, existing.id);
  assert.equal(runtime.mcp.list(project).length, 1);
  assert.equal(runtime.mcp.list(project)[0]?.toolCount, 1);
  assert.ok(initialized >= 1); assert.equal(listed, 1);
  await runtime.extensions.install(session.id, "mcp:deepwiki", true);
  assert.equal(listed, 1, "Idempotent install does not reconnect an active endpoint");
  await runtime.mcp.delete(existing.id);
  assert.equal((await runtime.extensions.list(session.id)).find((entry) => entry.id === "mcp:deepwiki")?.installed, false);
  assert.deepEqual(runtime.permissions.getPending(), []);
});

test("failed MCP discovery keeps installed configuration and never reports ready", async (t) => {
  const { runtime, session, project } = await fixture(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Controlled offline fixture"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await runtime.extensions.install(session.id, "mcp:context7", true);
  assert.equal(result.status, "needs-setup"); assert.equal(result.entry.installed, true); assert.equal(result.entry.connected, false);
  assert.match(result.message!, /Controlled offline fixture/);
  assert.equal(runtime.mcp.list(project).length, 1);
  await runtime.extensions.install(session.id, "mcp:context7", true);
  assert.equal(runtime.mcp.list(project).length, 1);
  assert.deepEqual(runtime.permissions.getPending(), []);
});

test("npx resolves to complete bundled npm and runs without system npx or a package download", async () => {
  const executable = resolveMcpExecutable("npx", ["--yes", "@playwright/mcp@0.0.83", "--isolated"]);
  assert.equal(executable.command, process.execPath);
  assert.match(executable.args[0]!, /npm[\\/]bin[\\/]npx-cli\.js$/);
  assert.deepEqual(executable.args.slice(1), ["--yes", "@playwright/mcp@0.0.83", "--isolated"]);
  const result = await promisify(execFile)(executable.command, [executable.args[0]!, "--version"], { windowsHide: true, timeout: 10_000 });
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("curated npm launch loads the exact isolated environment without config collisions or personal configuration", async (t) => {
  const { project } = await fixture(t);
  await writeFile(join(project, ".npmrc"), "registry=https://invalid.example.test\n");
  const launch = resolveMcpLaunch({ command: "npx", args: ["--yes", "@playwright/mcp@0.0.83", "--headless", "--isolated"], projectPath: project });
  assert.notEqual(launch.env.NPM_CONFIG_USERCONFIG, launch.env.NPM_CONFIG_GLOBALCONFIG);
  assert.notEqual(launch.cwd, project);
  assert.deepEqual(launch.args.slice(-2), ["--output-dir", join(project, ".playwright-mcp")]);
  assert.equal(launch.env.NPM_CONFIG_IGNORE_SCRIPTS, "true");
  const npmCli = join(dirname(launch.args[0]!), "npm-cli.js");
  const result = await promisify(execFile)(launch.command, [npmCli, "config", "get", "registry"], { cwd: launch.cwd, env: launch.env, windowsHide: true, timeout: 10_000 });
  assert.equal(result.stdout.trim(), "https://registry.npmjs.org");
  assert.equal(result.stderr.trim(), "");
});
