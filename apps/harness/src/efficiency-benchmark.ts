/** Offline, reproducible measurements. Tokens are character-based estimates, not billed usage. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodeIntelligence } from "./code.js";
import { compactPriorToolResults, estimateRequestTokens, estimateTokens, selectRelevantMarkdownSections } from "./context.js";
import { compactOutput } from "./logging.js";
import { createHarnessRuntime } from "./orchestrator.js";
import { SqlitePersistence } from "./persistence.js";
import { OpenAICompatibleProvider } from "./providers.js";
import type { ProviderRequest } from "./types.js";

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const stats = (samples: number[]) => { const sorted = [...samples].sort((a, b) => a - b); return { samples: samples.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] }; };
const reduction = (original: string, reduced: string) => ({ baselineEstimatedTokens: estimateTokens(original), optimizedEstimatedTokens: estimateTokens(reduced), reductionPercent: Number(((1 - reduced.length / original.length) * 100).toFixed(2)) });
async function time<T>(operation: () => Promise<T>) { const started = performance.now(); const result = await operation(); return { ms: performance.now() - started, result }; }

async function worker() {
  const provider = new OpenAICompatibleProvider("fixture", "Local fixture", argument("--worker")!, "local-test-only");
  const runtime = await createHarnessRuntime({ dataDirectory: argument("--data")!, providers: [provider] });
  try {
    const session = runtime.createSession({ projectPath: argument("--project")!, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "controlled" });
    const result = await runtime.run({ sessionId: session.id, goal: "Reply only OK. Do not use tools." });
    assert.equal(result.state, "COMPLETED");
    assert.equal(result.assistantMessage?.content, "OK");
  } finally { await runtime.close(); }
}

async function compareCli(root: string, executable: string) {
  const requests: Array<{ at: number; estimatedTokens: number; toolSchemas: number }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (request.method === "GET") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: [{ id: "controlled", object: "model" }] })); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProviderRequest;
    requests.push({ at: performance.now(), estimatedTokens: estimateTokens(JSON.stringify({ messages: body.messages, tools: body.tools })), toolSchemas: body.tools?.length ?? 0 });
    const base = { id: "local-controlled", model: "controlled", created: 1 };
    if (body.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    } else { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] })); }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  const project = join(root, "comparison-project");
  await mkdir(project);
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)) environment[key] = value;
  Object.assign(environment, { XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), OPENCODE_CONFIG_DIR: join(root, "config"), OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1" });
  const config = { model: "benchmark/controlled", small_model: "benchmark/controlled", autoupdate: false, share: "disabled", plugin: [], enabled_providers: ["benchmark"], provider: { benchmark: { npm: "@ai-sdk/openai-compatible", name: "Controlled local fixture", options: { baseURL: endpoint, apiKey: "local-test-only" }, models: { controlled: { name: "Controlled", limit: { context: 128000, output: 8192 } } } } } };
  environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  const version = spawnSync(executable, ["--version"], { env: environment, windowsHide: true, encoding: "utf8", timeout: 10_000 });
  assert.equal(version.status, 0, "Could not identify the installed competitor version");
  async function run(binary: string, args: string[], label: string, index: number) {
    const first = requests.length;
    const started = performance.now();
    const output: Buffer[] = [];
    await new Promise<void>((resolveRun, reject) => {
      const child = spawn(binary, args, { cwd: project, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`${label} timed out after 30s`)); }, 30_000);
      child.stdout.on("data", (data: Buffer) => output.push(data)); child.stderr.on("data", (data: Buffer) => output.push(data));
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("exit", (code) => { clearTimeout(timeout); if (code !== 0) reject(new Error(`${label} exited ${code}; see ${join(root, `${label}-${index}.log`)}`)); else resolveRun(); });
    }).finally(() => writeFile(join(root, `${label}-${index}.log`), Buffer.concat(output)));
    const captured = requests.slice(first);
    assert.ok(captured.length > 0, `${label} sent no fixture request`);
    assert.ok(Buffer.concat(output).toString().includes("OK") || label === "ordercode");
    return { totalMs: performance.now() - started, firstRequestMs: captured[0]!.at - started, calls: captured.length, estimatedInputTokens: captured.reduce((sum, item) => sum + item.estimatedTokens, 0), maxToolSchemas: Math.max(...captured.map((item) => item.toolSchemas)), requests: captured.map(({ at, ...item }) => ({ ...item, sinceStartMs: at - started })) };
  }
  try {
    const ordercode = []; const opencode = [];
    for (let index = 0; index < 5; index += 1) {
      const own = () => run(process.execPath, [fileURLToPath(import.meta.url), "--worker", endpoint, "--project", project, "--data", join(root, "ordercode-data")], "ordercode", index);
      const other = () => run(executable, ["run", "--format", "json", "--dir", project, "-m", "benchmark/controlled", "Reply only OK. Do not use tools."], "opencode", index);
      if (index % 2) { opencode.push(await other()); ordercode.push(await own()); } else { ordercode.push(await own()); opencode.push(await other()); }
    }
    return { scope: "Cold process launch, transport and default request overhead only. Same loopback stub replies OK. No model inference or coding-quality comparison. Filesystem/OS caches may be warm. Includes default background/title calls and shutdown; per-request breakdown is preserved.", configurationReference: "https://opencode.ai/docs/providers/#custom-provider", ordercode: { samples: ordercode, total: stats(ordercode.map((item) => item.totalMs)), firstRequest: stats(ordercode.map((item) => item.firstRequestMs)) }, opencode: { version: version.stdout.trim(), samples: opencode, total: stats(opencode.map((item) => item.totalMs)), firstRequest: stats(opencode.map((item) => item.firstRequestMs)) } };
  } finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
}

async function benchmark() {
  const root = await mkdtemp(join(tmpdir(), "ordercode-efficiency-benchmark-"));
  const project = join(root, "project"); await mkdir(project);
  const persistence = await SqlitePersistence.open(join(root, "index"));
  try {
    const source = "export function calculateInvoice(value:number){return value*1.21;}\n" + "// source evidence\n".repeat(1_000);
    const caller = "import {calculateInvoice} from './math.js';\nexport function checkout(){return calculateInvoice(100);}\n" + "// caller implementation\n".repeat(1_000);
    await writeFile(join(project, "math.ts"), source); await writeFile(join(project, "checkout.ts"), caller);
    for (let index = 0; index < 200; index += 1) await writeFile(join(project, `noise${index}.ts`), `export function unrelated${index}(){return ${index};}\n`);
    const code = new CodeIntelligence(persistence, { ripgrepCommand: null });
    const cold = await time(() => code.index(project));
    const indexTimes: number[] = []; const graphTimes: number[] = [];
    for (let index = 0; index < 15; index += 1) { indexTimes.push((await time(() => code.index(project))).ms); graphTimes.push((await time(() => code.graph(project, "calculateInvoice"))).ms); }
    const graph = await code.graph(project, "calculateInvoice");
    assert.ok(graph.relationships.some((edge) => edge.kind === "CALLS" && edge.targetName === "calculateInvoice"));
    assert.ok(graph.relationships.every((edge) => !edge.sourcePath.startsWith("noise")));
    await writeFile(join(project, "noise0.ts"), "export function changedOutside(){return 100;}\n"); code.invalidate(project, "noise0.ts");
    const incremental = await time(() => code.index(project)); assert.equal(incremental.result.updatedFiles, 1);
    const originalDocs = "# Project\nContract\n## Security\nNever expose secrets.\n## Token optimization\nUse selective context and keep evidence.\n" + Array.from({ length: 15 }, (_, index) => `## Unrelated feature ${index}\n${"Unrelated product details. ".repeat(400)}\n`).join("");
    const selectedDocs = selectRelevantMarkdownSections(originalDocs, "token optimization", { maxChars: 7_200, pinnedHeadings: ["Security"], relevantSections: 1 });
    assert.ok(selectedDocs.includes("Never expose secrets.") && selectedDocs.includes("Use selective context"));
    const log = "start-evidence\n" + "normal command output line\n".repeat(5_000) + "fatal: end-evidence";
    const compactedLog = compactOutput(log, 4_000)!; assert.ok(compactedLog.includes("start-evidence") && compactedLog.includes("fatal: end-evidence"));
    const history: ProviderRequest["messages"] = Array.from({ length: 12 }, (_, index) => ({ role: "tool", toolCallId: `${index}`, content: JSON.stringify({ content: `${index}:` + "evidence ".repeat(1_800) }) }));
    const compacted = compactPriorToolResults(history); assert.deepEqual(compacted.messages.slice(-4), history.slice(-4));
    const report: Record<string, unknown> = { measuredAt: new Date().toISOString(), node: process.version, platform: process.platform, method: "Local synthetic fixtures; all token counts use ceil(characters/4). No paid inference, no proof of real model latency or task quality superiority.", project: { files: cold.result.files, coldIndexMs: cold.ms, warmIndex: stats(indexTimes), warmGraph: stats(graphTimes), oneFileEditMs: incremental.ms, updatedFiles: incremental.result.updatedFiles }, context: { documents: reduction(originalDocs, selectedDocs), toolLog: reduction(log, compactedLog), oldToolHistory: reduction(JSON.stringify(history), JSON.stringify(compacted.messages.map(({ contextReduction: _, ...message }) => message))), graphVersusFullRelatedFiles: reduction(source + caller, JSON.stringify(graph)), graphVersusExactSourceLines: reduction(source.split("\n")[0]! + caller.split("\n").slice(0, 2).join("\n"), JSON.stringify(graph)), smallResultUnchanged: compactOutput("small result", 4_000) === "small result" }, historyEstimatedInput: estimateRequestTokens({ messages: compacted.messages, tools: [] }) };
    const workspace = argument("--workspace");
    if (workspace) {
      const query = argument("--query") ?? "recordProviderCost";
      const firstIndex = await time(() => code.index(resolve(workspace)));
      const samples: number[] = [];
      for (let index = 0; index < 7; index += 1) samples.push((await time(() => code.graph(resolve(workspace), query))).ms);
      const result = await code.graph(resolve(workspace), query);
      assert.ok(result.relationships.length > 0, "Real workspace query returned no relationships");
      report.realWorkspace = { path: resolve(workspace), query, files: firstIndex.result.files, symbols: firstIndex.result.symbols, firstIndexMs: firstIndex.ms, warmGraph: stats(samples), relationships: result.relationships, truncated: result.truncated, estimatedGraphTokens: estimateTokens(JSON.stringify(result)), note: "Reads the real workspace without modifying its files. Parsers were already initialized by the synthetic fixture. Inferred relationships need source verification." };
    }
    const competitor = argument("--opencode"); if (competitor) report.comparison = await compareCli(root, competitor);
    const output = resolve(argument("--output") ?? join(tmpdir(), "ordercode-efficiency-report.json"));
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: "PASS", report: output, evidenceDirectory: root, ...report }, null, 2));
  } finally { persistence.close(); /* Keep logs for review. Remove only generated project/index data. */
    assert.ok(basename(root).startsWith("ordercode-efficiency-benchmark-"));
    await rm(project, { recursive: true, force: true });
  }
}

if (argument("--worker")) await worker(); else await benchmark();
