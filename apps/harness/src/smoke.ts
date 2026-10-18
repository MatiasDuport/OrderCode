import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { CodeIntelligence } from "./code.js";
import { compactPriorToolResults, estimateCompactedToolResultSavings, selectRelevantMarkdownSections } from "./context.js";
import { createHarnessRuntime } from "./orchestrator.js";
import { ReleaseCenter } from "./release.js";
import { OpenAICompatibleProvider, type ProviderAdapter } from "./providers.js";
import { SqlitePersistence } from "./persistence.js";
import type { HarnessEvent, ProviderModel, ProviderRequest, ProviderTurn, ToolDefinition } from "./types.js";

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolveGit, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveGit(stdout) : reject(new Error(stderr || `git exited with code ${code}`)));
  });
}

async function hasRipgrep(): Promise<boolean> {
  const command = process.platform === "win32" ? "rg.exe" : "rg";
  return new Promise((resolveAvailable) => {
    const child = spawn(command, ["--version"], { windowsHide: true, stdio: "ignore" });
    child.once("error", () => resolveAvailable(false));
    child.once("close", (code) => resolveAvailable(code === 0));
  });
}

const largeToolHistory: ProviderRequest["messages"] = [
  { role: "tool", content: "x".repeat(4_000), toolCallId: "old-tool", toolName: "code.search" },
  ...Array.from({ length: 4 }, (_, index) => ({ role: "tool" as const, content: "y".repeat(4_000), toolCallId: `recent-${index}`, toolName: "code.search" })),
];
const compactedHistory = compactPriorToolResults(largeToolHistory);
if (!compactedHistory.compacted || !compactedHistory.messages[0] || compactedHistory.messages[0].content.length >= largeToolHistory[0]!.content.length || compactedHistory.messages.slice(1).some((message) => message.content.length !== 4_000)) {
  throw new Error("Old tool results were not shortened while the four most recent results remained intact.");
}
if (compactPriorToolResults(compactedHistory.messages).compacted) throw new Error("A previously compacted tool result was repeatedly compacted on later model calls.");
if (estimateCompactedToolResultSavings(compactedHistory.messages) <= 0) throw new Error("Estimated context savings were not calculated for a compacted tool result.");
const reducedToolOutput: ProviderRequest["messages"] = [{ role: "tool", content: JSON.stringify({ data: { content: `${"visible ".repeat(20)}\n… [12000 chars omitted] …\n`, truncated: true } }), toolCallId: "reduced-output", toolName: "fs.read" }];
if (estimateCompactedToolResultSavings(reducedToolOutput) <= 0) throw new Error("Estimated savings did not recognize a tool result reduced before entering conversation history.");
const selectedDocs = selectRelevantMarkdownSections("# Project\nIntro\n## Seguridad e integridad\nPermisos de archivos y validación.\n## Modelos y caché\nOptimizar el prefijo del proveedor reduce latencia.\n## Release Center\nPublicar un despliegue.", "optimizar caché del proveedor para menor latencia", { maxChars: 2_000, pinnedHeadings: ["Seguridad e integridad"], relevantSections: 1 });
if (!selectedDocs.includes("## Seguridad e integridad") || !selectedDocs.includes("## Modelos y caché") || selectedDocs.includes("## Release Center") || selectedDocs.length > 2_000) throw new Error("Project-document retrieval did not preserve pinned safety rules and the most relevant section within its budget.");

function fixtureProvider(pricing?: ProviderModel["pricing"]): ProviderAdapter {
  return {
    id: "fixture", label: "Fixture provider", baseUrl: "local://fixture", configured: true,
    async complete(request: ProviderRequest): Promise<ProviderTurn> { return this.stream(request, () => undefined); },
    async stream(request: ProviderRequest, onChunk: (chunk: string) => void): Promise<ProviderTurn> {
      if (!request.messages.some((message) => message.role === "system")) throw new Error("The agent request omitted its system context.");
      if (!request.messages[0]?.content.includes("smoke context rule")) throw new Error("The agent request omitted the project AGENTS.md context.");
      if (request.messages[0]?.content.includes("## Available tools")) throw new Error("Tool descriptions were duplicated in the system prompt instead of using the provider tool schemas.");
      if (request.tools?.some((tool) => tool.name === "desktop.terminal.open")) throw new Error("The UI-only terminal authorization was exposed to the model.");
      if (request.messages.some((message) => message.role === "user" && message.content.includes("usage-ledger-smoke"))) {
        return { content: "Usage ledger verified.", toolCalls: [], finishReason: "stop", inputTokens: 19, outputTokens: 8, cachedTokens: 3 };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("stream-batch-smoke"))) {
        const chunks = ["stream ", "events ", "batched"];
        for (const chunk of chunks) onChunk(chunk);
        return { content: chunks.join(""), toolCalls: [], finishReason: "stop" };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("parallel-read-smoke")) && !request.messages.some((message) => message.role === "tool")) {
        return { content: "", finishReason: "tool_calls", toolCalls: [
          { id: "fixture-parallel-read-1", name: "fs.read", arguments: { path: "parallel-a.txt" } },
          { id: "fixture-parallel-read-2", name: "fs.read", arguments: { path: "parallel-b.txt" } },
        ] };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("agent-test-smoke"))) {
        if (request.tools?.length) throw new Error("Agent Studio dry-run exposed executable tools to the model.");
        if (!request.messages[0]?.content.includes("Describe the relevant facts before conclusions.")) throw new Error("Agent Studio dry-run omitted the saved profile instructions.");
        const content = "Agent test response with no tools.";
        onChunk(content);
        return { content, toolCalls: [], finishReason: "stop", inputTokens: 12, outputTokens: 8 };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("Review this security concern"))) {
        if (request.tools?.length || request.model !== "fixture-model") throw new Error("A delegated specialist did not inherit the selected model with its own tools disabled.");
        return { content: "The supplied context shows a security concern; validate its permission boundary.", toolCalls: [], finishReason: "stop", inputTokens: 9, outputTokens: 11, cachedTokens: 5 };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("delegation-main-smoke")) && !request.messages.some((message) => message.role === "tool")) {
        if (!request.tools?.some((tool) => tool.name === "agents.delegate")) throw new Error("The primary agent was not offered controlled specialist delegation.");
        return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "fixture-delegate-1", name: "agents.delegate", arguments: { role: "security", task: "Review this security concern", context: "The parent supplied a short code excerpt." } }], cachedTokens: 2 };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("budget-output-smoke"))) {
        if (request.maxOutputTokens !== 7) throw new Error("The session output-token ceiling was not forwarded to the selected provider.");
        return { content: "Budget checked.", toolCalls: [], finishReason: "stop", inputTokens: 3, outputTokens: 7 };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("cost-delegation-smoke")) && !request.messages.some((message) => message.role === "tool")) {
        return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "fixture-cost-delegate", name: "agents.delegate", arguments: { role: "security", task: "cost-delegate-specialist-task" } }], inputTokens: 5, outputTokens: 2, costUsd: 0.00001, costKind: "exact" };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("cost-delegate-specialist-task"))) {
        if (!Number.isSafeInteger(request.maxOutputTokens) || Number(request.maxOutputTokens) <= 0) throw new Error("The cost limit was not forwarded to a delegated specialist.");
        return { content: "Specialist cost tracked.", toolCalls: [], finishReason: "stop", inputTokens: 4, outputTokens: 3, costUsd: 0.0003, costKind: "exact" };
      }
      if (request.messages.some((message) => message.role === "user" && /cost-(?:exact|estimate|overrun)-smoke/.test(message.content))) {
        if (!Number.isSafeInteger(request.maxOutputTokens) || Number(request.maxOutputTokens) <= 0) throw new Error("The verified cost ceiling was not converted into a provider output cap.");
        const userContent = request.messages.find((message) => message.role === "user")?.content ?? "";
        const overrun = userContent.includes("cost-overrun-smoke");
        return {
          content: overrun ? "Cost cap reached." : "Cost budget verified.",
          finishReason: overrun ? "tool_calls" : "stop",
          toolCalls: overrun ? [{ id: "fixture-cost-write", name: "fs.write", arguments: { path: "cost-overrun.txt", content: "must not run" } }] : [],
          inputTokens: 5,
          outputTokens: 3,
          ...(userContent.includes("cost-estimate-smoke") ? {} : { costUsd: overrun ? 0.0003 : 0.00001, costKind: "exact" as const }),
        };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("budget-input-smoke"))) {
        return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "fixture-budget-input", name: "fs.write", arguments: { path: "budget-input.txt", content: "must not run" } }], inputTokens: 9, outputTokens: 1 };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("budget-tool-smoke"))) {
        return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "fixture-budget-tool", name: "fs.write", arguments: { path: "budget-tool.txt", content: "must not run" } }], inputTokens: 2, outputTokens: 1 };
      }
      if (request.messages.some((message) => message.role === "user" && message.content.includes("agent-profile-smoke"))) {
        if (request.tools?.length !== 1 || request.tools[0]?.name !== "fs.read") throw new Error("A custom agent received tools outside its explicit allowlist.");
        if (!request.messages[0]?.content.includes("Describe the relevant facts before conclusions.")) throw new Error("Custom agent instructions were not included in its system context.");
        const content = "Custom agent profile and tool limits verified.";
        onChunk(content);
        return { content, toolCalls: [], finishReason: "stop" };
      }
      if (request.messages.some((message) => message.role === "tool")) {
        const content = "Archivo actualizado y operación recuperada tras la autorización.";
        onChunk(content);
        return { content, toolCalls: [], finishReason: "stop" };
      }
      return {
        content: "Voy a escribir el archivo solicitado.", finishReason: "tool_calls",
        toolCalls: [{ id: "fixture-write-1", name: "fs.write", arguments: { path: "recovered.txt", content: "OrderCode durable approval" } }],
      };
    },
    async listModels() { return [{ id: "fixture-model", providerId: "fixture", label: "Fixture model", capabilities: ["chat", "streaming", "tool-calling"], available: true, priceKind: pricing ? "paid" : "unknown", ...(pricing ? { pricing } : {}) }]; },
  };
}

const directory = await mkdtemp(join(tmpdir(), "ordercode-harness-smoke-"));
const project = await mkdtemp(join(tmpdir(), "ordercode-project-"));
const costDirectory = await mkdtemp(join(tmpdir(), "ordercode-cost-smoke-"));
const migrationDirectory = await mkdtemp(join(tmpdir(), "ordercode-usage-migration-smoke-"));
let runtime = await createHarnessRuntime({ dataDirectory: directory, providers: [fixtureProvider()] });
let costRuntime: Awaited<ReturnType<typeof createHarnessRuntime>> | undefined;
let migrationPersistence: SqlitePersistence | undefined;
try {
  let calledDeployUrl = "";
  const releaseProbe = new ReleaseCenter(async (input, init) => {
    calledDeployUrl = String(input);
    if (init?.method !== "POST" || init.redirect !== "error") throw new Error("Vercel Deploy Hook requests must use a non-redirecting POST.");
    return new Response(JSON.stringify({ job: { id: "dpl_smoke1234", state: "PENDING", createdAt: 123 } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  for (const invalidHook of ["http://api.vercel.com/v1/integrations/deploy/prj_12345678/hook_12345678", "https://api.vercel.com.evil.test/v1/integrations/deploy/prj_12345678/hook_12345678"]) {
    let invalidRejected = false;
    try { releaseProbe.configureDeployHook(project, invalidHook); } catch { invalidRejected = true; }
    if (!invalidRejected) throw new Error("Release Center accepted an insecure or non-Vercel Deploy Hook URL.");
  }
  releaseProbe.configureDeployHook(project, "https://api.vercel.com/v1/integrations/deploy/prj_12345678/hook_12345678");
  const deployment = await releaseProbe.triggerDeploy(project);
  if (calledDeployUrl !== "https://api.vercel.com/v1/integrations/deploy/prj_12345678/hook_12345678" || deployment.jobId !== "dpl_smoke1234" || deployment.state !== "PENDING") throw new Error("Release Center did not securely request and parse the mocked Vercel deployment job.");
  if (!releaseProbe.deployHookConfigured(project) || releaseProbe.deployHookConfigured(join(project, "other-workspace"))) throw new Error("Release Center shared a project-specific Deploy Hook with another workspace.");
  await git(project, "init", "-q");
  await git(project, "config", "user.name", "OrderCode Smoke");
  await git(project, "config", "user.email", "ordercode-smoke@localhost");
  await git(project, "remote", "add", "origin", "https://smoke-token:smoke-secret@example.invalid/ordercode.git");
  await writeFile(join(project, "tracked.txt"), "initial\n");
  await writeFile(join(project, "AGENTS.md"), "smoke context rule");
  await writeFile(join(project, "parallel-a.txt"), "parallel read A");
  await writeFile(join(project, "parallel-b.txt"), "parallel read B");
  const skillPath = ".agents/skills/review-helper/SKILL.md";
  await mkdir(join(project, ".agents", "skills", "review-helper"), { recursive: true });
  await writeFile(join(project, skillPath), "---\nname: Review Helper\ndescription: Focus review on concrete regressions.\n---\nCheck changed behavior and cite evidence.");
  await writeFile(join(project, ".agents", "skills", "review-helper", "reference.md"), "A focused review starts with observable behavior.");
  await git(project, "add", "tracked.txt");
  await git(project, "add", "AGENTS.md");
  await git(project, "add", "parallel-a.txt");
  await git(project, "add", "parallel-b.txt");
  await git(project, "add", ".agents/skills/review-helper/SKILL.md");
  await git(project, "add", ".agents/skills/review-helper/reference.md");
  await git(project, "commit", "-q", "-m", "Initial fixture");

  const parallelReadSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model" });
  const parallelReadRun = await runtime.run({ sessionId: parallelReadSession.id, goal: "parallel-read-smoke" });
  const parallelReadResults = parallelReadRun.toolResults.filter((result) => result.toolName === "fs.read");
  if (parallelReadRun.state !== "COMPLETED" || parallelReadRun.usage.toolCalls !== 2 || parallelReadResults.length !== 2 || !JSON.stringify(parallelReadResults).includes("parallel read A") || !JSON.stringify(parallelReadResults).includes("parallel read B")) throw new Error("Independent read-only calls were not executed together and returned in full.");

  const directSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided" });
  const deployTool = runtime.tools.list(project).find((tool) => tool.name === "release.deploy");
  const deployApprovalResult = await runtime.tools.invoke({ name: "release.deploy", input: {}, context: { sessionId: directSession.id, projectPath: project, agentId: "release", permissionProfile: "guided", mode: "build" } });
  const deployApproval = (deployApprovalResult.data as { permissionRequest?: { id: string; effect: string; destination?: string } }).permissionRequest;
  if (!deployTool?.effects.includes("PUBLISH") || deployApprovalResult.status !== "rejected" || deployApproval?.effect !== "PUBLISH" || deployApproval.destination !== "https://api.vercel.com") throw new Error("A Vercel deployment did not require destination-bound publish approval.");
  await runtime.resolvePermission(deployApproval.id, "reject");
  const discoveredSkills = await runtime.skills.list(project);
  if (discoveredSkills.length !== 1 || discoveredSkills[0]?.name !== "Review Helper" || discoveredSkills[0].enabled || !discoveredSkills[0].resources.includes(".agents/skills/review-helper/reference.md")) throw new Error("The project Skills Manager did not discover SKILL.md metadata and its safe resource list.");
  const enabledSkills = await runtime.skills.setEnabled(project, skillPath, true);
  if (!enabledSkills[0]?.enabled || !(await runtime.skills.activeInstructions(project)).includes("cite evidence") || !(await runtime.skills.activeInstructions(project)).includes(".agents/skills/review-helper/reference.md")) throw new Error("An enabled project Skill or its progressive resource references were not included in the active runtime context.");
  const skillContent = await runtime.skills.read(project, skillPath);
  if (!skillContent.content.includes("cite evidence") || skillContent.sha256.length !== 64) throw new Error("The Skills Manager could not read and hash a supported project SKILL.md file.");
  const authoringInput = { name: "fs.write", input: { path: ".agents/skills/authoring-smoke/SKILL.md", content: "---\nname: Authoring Smoke\ndescription: Test permission-gated skill authoring.\n---\nWrite only verified instructions.", expectedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }, context: { sessionId: directSession.id, projectPath: project, agentId: "user", permissionProfile: "guided" as const, mode: "build" as const } };
  const authoringGate = await runtime.tools.invoke(authoringInput);
  const authoringPermission = (authoringGate.data as { permissionRequest?: { id: string } }).permissionRequest;
  if (authoringGate.status !== "rejected" || !authoringPermission) throw new Error("Creating a project Skill bypassed the write permission engine.");
  await runtime.resolvePermission(authoringPermission.id, "once");
  if ((await runtime.tools.invoke(authoringInput)).status !== "completed") throw new Error("An approved project Skill creation did not complete.");
  const authoredSkill = (await runtime.skills.list(project)).find((skill) => skill.id === ".agents/skills/authoring-smoke/SKILL.md");
  if (!authoredSkill || authoredSkill.name !== "Authoring Smoke") throw new Error("The newly authored SKILL.md was not imported into the project Skills Manager.");
  await git(project, "add", ".agents/skills/authoring-smoke/SKILL.md");
  await git(project, "commit", "-q", "-m", "Add permission-gated project Skill");
  const externalSkills = join(directory, "external-skills");
  await mkdir(join(externalSkills, "outside-helper"), { recursive: true });
  await writeFile(join(externalSkills, "outside-helper", "SKILL.md"), "---\nname: Outside Helper\n---\nThis must remain outside the project context.");
  let symlinkSupported = false;
  try { await symlink(externalSkills, join(project, ".claude"), "junction"); symlinkSupported = true; } catch { /* Symlink creation may be disabled by the Windows host. */ }
  if (symlinkSupported) {
    if ((await runtime.skills.list(project)).some((skill) => skill.name === "Outside Helper")) throw new Error("The Skills Manager followed a project symlink outside the active workspace.");
    await rm(join(project, ".claude"), { recursive: true, force: true });
  }
  let rejectedSkillPath = false;
  try { await runtime.skills.setEnabled(project, "../outside/SKILL.md", true); } catch { rejectedSkillPath = true; }
  if (!rejectedSkillPath) throw new Error("The Skills Manager accepted a path outside supported project skill directories.");
  const gitStatus = await runtime.tools.invoke({ name: "git.status", input: {}, context: { sessionId: directSession.id, projectPath: project, agentId: "explore", permissionProfile: "reading", mode: "build" } });
  if (gitStatus.status !== "completed" || !(gitStatus.data as { stdout?: string }).stdout?.includes("## ")) throw new Error("Git status did not return the real repository state.");
  const remotes = await runtime.tools.invoke({ name: "git.remotes", input: {}, context: { sessionId: directSession.id, projectPath: project, agentId: "explore", permissionProfile: "reading", mode: "build" } });
  const remoteOutput = (remotes.data as { stdout?: string }).stdout ?? "";
  if (remotes.status !== "completed" || !remoteOutput.includes("[credentials]@example.invalid") || remoteOutput.includes("smoke-token") || remoteOutput.includes("smoke-secret")) throw new Error("Git remote credentials were not masked in the destination list.");
  await writeFile(join(project, "tracked.txt"), "updated\n");
  const stageInput = { name: "git.stage", input: { paths: ["tracked.txt"] }, context: { sessionId: directSession.id, projectPath: project, agentId: "build", permissionProfile: "guided" as const, mode: "build" as const } };
  const stageRequestResult = await runtime.tools.invoke(stageInput);
  const stageRequest = (stageRequestResult.data as { permissionRequest?: { id: string } }).permissionRequest;
  if (stageRequestResult.status !== "rejected" || !stageRequest) throw new Error("Git staging did not require authorization under the guided profile.");
  await runtime.resolvePermission(stageRequest.id, "once");
  const staged = await runtime.tools.invoke(stageInput);
  if (staged.status !== "completed") throw new Error(`Authorized Git staging failed: ${staged.summary}`);
  const stagedDiff = await runtime.tools.invoke({ name: "git.diff", input: { staged: true }, context: { sessionId: directSession.id, projectPath: project, agentId: "review", permissionProfile: "reading", mode: "build" } });
  if (stagedDiff.status !== "completed" || !(stagedDiff.data as { stdout?: string }).stdout?.includes("+updated")) throw new Error("The staged Git diff did not include the selected file change.");
  const unstage = await runtime.tools.invoke({ name: "git.unstage", input: { paths: ["tracked.txt"] }, context: { sessionId: directSession.id, projectPath: project, agentId: "build", permissionProfile: "advanced", mode: "build" } });
  const unstagedCheck = await runtime.tools.invoke({ name: "git.diff", input: { staged: true }, context: { sessionId: directSession.id, projectPath: project, agentId: "review", permissionProfile: "reading", mode: "build" } });
  if (unstage.status !== "completed" || (unstagedCheck.data as { stdout?: string }).stdout?.includes("+updated")) throw new Error("Git could not remove the selected path from the index.");
  const restage = await runtime.tools.invoke({ name: "git.stage", input: { paths: ["tracked.txt"] }, context: { sessionId: directSession.id, projectPath: project, agentId: "build", permissionProfile: "advanced", mode: "build" } });
  if (restage.status !== "completed") throw new Error("Git could not restage the selected path.");
  const committed = await runtime.tools.invoke({ name: "git.commit", input: { message: "Smoke commit" }, context: { sessionId: directSession.id, projectPath: project, agentId: "build", permissionProfile: "advanced", mode: "build" } });
  if (committed.status !== "completed") throw new Error(`Git commit failed: ${committed.summary}`);
  const branch = await runtime.tools.invoke({ name: "git.branch.create", input: { name: "feature/smoke" }, context: { sessionId: directSession.id, projectPath: project, agentId: "build", permissionProfile: "advanced", mode: "build" } });
  if (branch.status !== "completed") throw new Error(`Git branch creation failed: ${branch.summary}`);
  const tag = await runtime.tools.invoke({ name: "git.tag.create", input: { name: "v0.1.0-smoke", message: "Verified smoke release" }, context: { sessionId: directSession.id, projectPath: project, agentId: "release", permissionProfile: "advanced", mode: "build" } });
  const tags = await runtime.tools.invoke({ name: "git.tags", input: {}, context: { sessionId: directSession.id, projectPath: project, agentId: "review", permissionProfile: "reading", mode: "build" } });
  if (tag.status !== "completed" || !(tags.data as { stdout?: string }).stdout?.includes("v0.1.0-smoke")) throw new Error("Release Center could not create and list an annotated tag.");
  const tagPushResult = await runtime.tools.invoke({ name: "git.tag.push", input: { remote: "origin", tag: "v0.1.0-smoke", destination: "https://[credentials]@example.invalid/ordercode.git" }, context: { sessionId: directSession.id, projectPath: project, agentId: "general", permissionProfile: "advanced", mode: "build" } });
  const tagPushRequest = (tagPushResult.data as { permissionRequest?: { id: string; destination?: string } }).permissionRequest;
  if (tagPushResult.status !== "rejected" || !tagPushRequest || !tagPushRequest.destination?.includes("example.invalid")) throw new Error("Git tag publication did not require destination-bound approval.");
  await runtime.resolvePermission(tagPushRequest.id, "reject");
  const pushRequestResult = await runtime.tools.invoke({ name: "git.push", input: { remote: "origin", branch: "feature/smoke", destination: "https://[credentials]@example.invalid/ordercode.git" }, context: { sessionId: directSession.id, projectPath: project, agentId: "general", permissionProfile: "advanced", mode: "build" } });
  const pushRequest = (pushRequestResult.data as { permissionRequest?: { id: string; destination?: string } }).permissionRequest;
  if (pushRequestResult.status !== "rejected" || !pushRequest || !pushRequest.destination?.includes("example.invalid")) throw new Error("Git push did not require approval bound to its sanitized publish destination.");
  await runtime.resolvePermission(pushRequest.id, "reject");

  const missing = await runtime.tools.invoke({ name: "fs.read", input: { path: "missing.txt" }, context: { sessionId: directSession.id, projectPath: project, agentId: "general", permissionProfile: "reading", mode: "build" } });
  if (missing.status !== "failed") throw new Error(`Expected missing file failure, received ${missing.status}`);
  const command = await runtime.tools.invoke({ name: "process.exec", input: { command: "node -e \"process.stdout.write('smoke-process-ok')\"" }, context: { sessionId: directSession.id, projectPath: project, agentId: "qa", permissionProfile: "advanced", mode: "build" } });
  const commandData = command.data as { stdout?: string } | undefined;
  if (command.status !== "completed" || commandData?.stdout !== "smoke-process-ok" || !command.logRef) throw new Error("A real process result or its recoverable log was lost.");

  const largeMcpDefinition: ToolDefinition = { name: "mcp_fixture_large_output_tool", description: "Fixture returning a large result.", effects: ["READ"], cancellable: false, inputSchema: { type: "object", properties: {} } };
  runtime.tools.registerMcpTool({ definition: largeMcpDefinition, projectPath: project, permissionEffect: "READ", invoke: async () => ({ text: "mcp-large-output-".repeat(1_500) }) });
  const largeMcpResult = await runtime.invokeTool(directSession.id, largeMcpDefinition.name, {});
  const largeMcpData = largeMcpResult.data as { compacted?: boolean; originalChars?: number; preview?: string } | undefined;
  if (!largeMcpResult.ok || largeMcpData?.compacted !== true || (largeMcpData.originalChars ?? 0) <= 8_000 || (largeMcpData.preview?.length ?? 8_001) > 8_000) throw new Error("A large MCP response was not compacted before being returned to the model.");
  runtime.tools.unregisterMcpTools("fixture_large_output");

  const requestWrite = { name: "fs.write", input: { path: "answer.txt", content: "ok" }, context: { sessionId: directSession.id, projectPath: project, agentId: "build", permissionProfile: "guided" as const, mode: "build" as const } };
  const denied = await runtime.tools.invoke(requestWrite);
  if (denied.status !== "rejected") throw new Error(`Expected approval gate, received ${denied.status}`);
  const request = (denied.data as { permissionRequest?: { id: string } }).permissionRequest;
  if (!request) throw new Error("Approval request was not returned.");
  await runtime.resolvePermission(request.id, "once");
  const written = await runtime.tools.invoke(requestWrite);
  if (!written.ok || await readFile(join(project, "answer.txt"), "utf8") !== "ok") throw new Error("Authorized write failed.");
  const secondWrite = await runtime.tools.invoke({ ...requestWrite, input: { path: "answer.txt", content: "changed" } });
  if (secondWrite.status !== "rejected") throw new Error("A single-use permission was reused for different arguments.");
  const autoCommand = await runtime.tools.invoke({ name: "process.exec", input: { command: "node --version" }, context: { ...requestWrite.context, permissionProfile: "auto" } });
  if (autoCommand.status !== "rejected" || !(autoCommand.data as { permissionRequest?: unknown }).permissionRequest) throw new Error("Auto permissions ran a shell command without approval.");

  const terminalInvocation = { name: "desktop.terminal.open", input: { shell: "default" }, context: { ...requestWrite.context } };
  const terminalPending = await runtime.tools.invoke(terminalInvocation);
  const terminalRequest = (terminalPending.data as { permissionRequest?: { id: string } }).permissionRequest;
  if (terminalPending.status !== "rejected" || !terminalRequest) throw new Error("Opening a PTY did not require an explicit permission decision.");
  await runtime.resolvePermission(terminalRequest.id, "once");
  const terminalApproved = await runtime.tools.invoke(terminalInvocation);
  const terminalToken = (terminalApproved.data as { authorizationId?: string }).authorizationId;
  if (terminalApproved.status !== "completed" || !terminalToken) throw new Error("The approved PTY request did not produce a short-lived native authorization.");
  if (runtime.tools.consumeTerminalAuthorization(terminalToken, "other-session", project, "default")) throw new Error("A PTY authorization was accepted for another session.");
  if (!runtime.tools.consumeTerminalAuthorization(terminalToken, directSession.id, project, "default")) throw new Error("The correct native PTY authorization could not be consumed.");
  if (runtime.tools.consumeTerminalAuthorization(terminalToken, directSession.id, project, "default")) throw new Error("A native PTY authorization could be replayed.");
  const planTerminal = await runtime.tools.invoke({ ...terminalInvocation, context: { ...terminalInvocation.context, mode: "plan" as const, permissionProfile: "advanced" as const } });
  if (planTerminal.status !== "rejected" || (planTerminal.data as { permissionRequest?: unknown }).permissionRequest) throw new Error("Plan mode allowed an interactive PTY request.");

  const planWrite = await runtime.tools.invoke({ ...requestWrite, input: { path: "plan.txt", content: "forbidden" }, context: { ...requestWrite.context, permissionProfile: "advanced", mode: "plan" } });
  if (planWrite.status !== "rejected" || (planWrite.data as { permissionRequest?: unknown }).permissionRequest) throw new Error("Plan mode did not hard-block a write.");
  const outsideRead = await runtime.tools.invoke({ name: "fs.read", input: { path: "../outside.txt" }, context: { ...requestWrite.context, permissionProfile: "reading" } });
  if (outsideRead.status !== "rejected") throw new Error("The permission engine allowed a path outside the project.");

  await writeFile(join(project, "AGENTS.md"), "smoke context rule");
  const streamBatchSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model" });
  const streamBatchRun = await runtime.run({ sessionId: streamBatchSession.id, goal: "stream-batch-smoke" });
  const streamEvents = runtime.listEvents(streamBatchSession.id).filter((event) => event.type === "provider.chunk");
  if (streamBatchRun.state !== "COMPLETED" || streamEvents.length !== 1 || streamEvents[0]?.payload.chunk !== "stream events batched") throw new Error("Streaming chunks were not coalesced into one final durable update without losing text.");
  const missingUsage = runtime.getUsageAnalytics({ projectPath: project, days: 0, sessionId: streamBatchSession.id });
  if (missingUsage.providerCalls !== 1 || missingUsage.measuredCalls !== 0 || missingUsage.reportedTokenRecords !== 0 || missingUsage.inputTokens !== 0) throw new Error("Missing provider token metrics were incorrectly presented as measured zero usage.");
  await writeFile(join(project, "AGENTS.md"), `smoke context rule\n\n## Unused guidance\n${"retained only in the source document ".repeat(500)}`);
  const usageSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model" });
  const usageRun = await runtime.run({ sessionId: usageSession.id, goal: "usage-ledger-smoke" });
  const measuredUsage = runtime.getUsageAnalytics({ projectPath: project, days: 0, sessionId: usageSession.id });
  if (usageRun.state !== "COMPLETED" || measuredUsage.providerCalls !== 1 || measuredUsage.measuredCalls !== 1 || measuredUsage.inputTokens !== 19 || measuredUsage.outputTokens !== 8 || measuredUsage.cachedTokens !== 3 || measuredUsage.savingsCalls !== 1 || measuredUsage.estimatedSavedTokens <= 0 || measuredUsage.activeDays !== 1) {
    throw new Error("Provider-reported usage, estimated context savings, or active-day analytics were not persisted correctly.");
  }
  const idempotentTime = new Date();
  const idempotentDay = `${idempotentTime.getFullYear()}-${String(idempotentTime.getMonth() + 1).padStart(2, "0")}-${String(idempotentTime.getDate()).padStart(2, "0")}`;
  const idempotentRecord = { id: "usage-idempotency-smoke", sessionId: usageSession.id, projectPath: project, runId: "idempotency-smoke", providerId: "fixture", modelId: "idempotency-model", occurredAt: idempotentTime.toISOString(), localDay: idempotentDay, estimatedSentTokens: 20, estimatedSavedTokens: 4 };
  runtime.persistence.recordUsageCall(idempotentRecord);
  runtime.persistence.recordUsageCall({ ...idempotentRecord, inputTokens: 10, outputTokens: 4, measuredCalls: 1 });
  const idempotentUsage = runtime.getUsageAnalytics({ projectPath: project, days: 0, sessionId: usageSession.id, modelId: "idempotency-model" });
  if (idempotentUsage.providerCalls !== 1 || idempotentUsage.inputTokens !== 10 || idempotentUsage.outputTokens !== 4) throw new Error("A streamed usage record was duplicated instead of being completed idempotently.");
  const delegatedSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model" });
  const delegatedRun = await runtime.run({ sessionId: delegatedSession.id, goal: "delegation-main-smoke" });
  const delegatedResult = delegatedRun.toolResults.find((result) => result.toolName === "agents.delegate");
  if (delegatedRun.state !== "COMPLETED" || delegatedRun.usage.providerCalls !== 3 || delegatedRun.usage.toolCalls !== 1 || delegatedRun.usage.cachedTokens !== 7 || !JSON.stringify(delegatedResult?.data).includes("security concern")) throw new Error("The official security specialist did not complete a visible, same-model, read-only delegated analysis with aggregated cached-token usage.");
  const delegatedUsage = runtime.getUsageAnalytics({ projectPath: project, days: 0, sessionId: delegatedSession.id });
  if (delegatedUsage.providerCalls !== 3 || delegatedUsage.measuredCalls !== 1 || delegatedUsage.inputTokens !== 9 || delegatedUsage.outputTokens !== 11 || delegatedUsage.cachedTokens !== 7) throw new Error("Root model calls and specialist usage were not aggregated with missing token reports left unknown.");
  if (!runtime.listEvents(delegatedSession.id).some((event) => event.type === "tool.started" && event.payload.toolName === "agents.delegate") || !runtime.listEvents(delegatedSession.id).some((event) => event.type === "tool.completed" && event.payload.toolName === "agents.delegate")) throw new Error("Specialist delegation was not represented in the durable activity log.");
  const unknownCostSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: null, maxOutputTokens: null, maxCostUsd: 1, maxDurationMs: null, maxToolCalls: null } });
  const unknownCostRun = await runtime.run({ sessionId: unknownCostSession.id, goal: "unknown-cost-smoke" });
  if (unknownCostRun.state !== "WAITING_USER" || unknownCostRun.usage.providerCalls !== 0 || !unknownCostRun.reason?.includes("verified pricing")) throw new Error("A cost ceiling did not fail closed before inference when model pricing was unknown.");
  const outputBudgetSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: null, maxOutputTokens: 7, maxCostUsd: null, maxDurationMs: null, maxToolCalls: null } });
  const budgetOutputRun = await runtime.run({ sessionId: outputBudgetSession.id, goal: "budget-output-smoke" });
  if (budgetOutputRun.state !== "COMPLETED" || budgetOutputRun.usage.outputTokens !== 7 || runtime.getSession(outputBudgetSession.id).budget?.maxOutputTokens !== 7) throw new Error("The output-token ceiling did not persist or reach the provider request.");
  const inputBudgetSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "advanced", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: 4, maxOutputTokens: null, maxCostUsd: null, maxDurationMs: null, maxToolCalls: null } });
  const budgetInputRun = await runtime.run({ sessionId: inputBudgetSession.id, goal: "budget-input-smoke" });
  if (budgetInputRun.state !== "WAITING_USER" || !budgetInputRun.reason?.includes("input above") || await readFile(join(project, "budget-input.txt"), "utf8").then(() => true, () => false)) throw new Error("The input-token ceiling did not stop tool actions after the provider reported the usage.");
  const toolBudgetSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "advanced", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxDurationMs: null, maxToolCalls: 0 } });
  const budgetToolRun = await runtime.run({ sessionId: toolBudgetSession.id, goal: "budget-tool-smoke" });
  if (budgetToolRun.state !== "WAITING_USER" || !budgetToolRun.reason?.includes("tool-call budget") || await readFile(join(project, "budget-tool.txt"), "utf8").then(() => true, () => false)) throw new Error("The tool-call ceiling did not stop an unapproved write before execution.");
  const durationBudgetSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "advanced", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxDurationMs: 1, maxToolCalls: null } });
  const budgetDurationRun = await runtime.run({ sessionId: durationBudgetSession.id, goal: "duration-budget-smoke" });
  if (budgetDurationRun.state !== "WAITING_USER" || budgetDurationRun.usage.providerCalls !== 0 || !budgetDurationRun.reason?.includes("time budget")) throw new Error("The session duration ceiling did not stop the run before inference.");
  const fixturePricing: NonNullable<ProviderModel["pricing"]> = { inputPerMillionUsd: 0.001, outputPerMillionUsd: 0.002, updatedAt: new Date().toISOString() };
  costRuntime = await createHarnessRuntime({ dataDirectory: costDirectory, providers: [fixtureProvider(fixturePricing)] });
  const exactCostSession = costRuntime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: null, maxOutputTokens: null, maxCostUsd: 0.01, maxDurationMs: null, maxToolCalls: null } });
  const exactCostRun = await costRuntime.run({ sessionId: exactCostSession.id, goal: "cost-exact-smoke" });
  if (exactCostRun.state !== "COMPLETED" || exactCostRun.usage.costKind !== "exact" || exactCostRun.usage.costUsd !== 0.00001) throw new Error("A provider-reported cost was not preserved as exact usage.");
  const estimatedCostSession = costRuntime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: null, maxOutputTokens: null, maxCostUsd: 0.01, maxDurationMs: null, maxToolCalls: null } });
  const estimatedCostRun = await costRuntime.run({ sessionId: estimatedCostSession.id, goal: "cost-estimate-smoke" });
  if (estimatedCostRun.state !== "COMPLETED" || estimatedCostRun.usage.costKind !== "estimated" || !(estimatedCostRun.usage.costUsd! > 0)) throw new Error("Cost usage was not estimated from verified model pricing and token counts.");
  const overrunCostSession = costRuntime.createSession({ projectPath: project, mode: "build", permissionProfile: "advanced", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: null, maxOutputTokens: null, maxCostUsd: 0.0001, maxDurationMs: null, maxToolCalls: null } });
  const overrunCostRun = await costRuntime.run({ sessionId: overrunCostSession.id, goal: "cost-overrun-smoke" });
  if (overrunCostRun.state !== "WAITING_USER" || !overrunCostRun.reason?.includes("configured ceiling") || overrunCostRun.usage.toolCalls !== 0 || await readFile(join(project, "cost-overrun.txt"), "utf8").then(() => true, () => false)) throw new Error(`Reported cost above the ceiling did not stop tool actions: ${JSON.stringify({ state: overrunCostRun.state, reason: overrunCostRun.reason, usage: overrunCostRun.usage, results: overrunCostRun.toolResults })}`);
  const delegatedCostSession = costRuntime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model", budget: { maxInputTokens: null, maxOutputTokens: null, maxCostUsd: 0.0002, maxDurationMs: null, maxToolCalls: null } });
  const delegatedCostRun = await costRuntime.run({ sessionId: delegatedCostSession.id, goal: "cost-delegation-smoke" });
  if (delegatedCostRun.state !== "WAITING_USER" || delegatedCostRun.usage.providerCalls !== 2 || delegatedCostRun.usage.costUsd !== 0.00031 || !delegatedCostRun.reason?.includes("specialist reached")) throw new Error("Delegated model usage was not included in the cost ceiling and budget totals.");
  await mkdir(join(project, "src"), { recursive: true });
  await writeFile(join(project, "src", "lib.ts"), "export function sharedHelper() { return 'helper'; }\n");
  const indexedFile = join(project, "src", "searchable.ts");
  await writeFile(indexedFile, "import { sharedHelper } from './lib';\nexport function ordercodeAnchorSymbol() { return sharedHelper() + ' persistent unique needle'; }\nexport function unrelatedAnchorSymbol() { return sharedHelper(); }\n");
  await writeFile(join(project, "src", "guide.py"), "from library.helpers import shared_helper\ndef python_anchor():\n    return shared_helper()\n");
  await writeFile(join(project, "src", "guide.rs"), "use crate::helpers::shared_helper;\nfn rust_anchor() { shared_helper(); }\n");
  const initialIndex = await runtime.code.index(project);
  if (initialIndex.files < 1 || initialIndex.updatedFiles < 1) throw new Error("Code Intelligence did not persist its first incremental index.");
  const symbolSearch = await runtime.code.search(project, "ordercodeAnchorSymbol");
  if (!symbolSearch.some((symbol) => symbol.kind === "function" && symbol.path === "src/searchable.ts")) throw new Error("Code Intelligence did not return the indexed function symbol.");
  if (!(await runtime.code.search(project, "python_anchor")).some((symbol) => symbol.path === "src/guide.py") || !(await runtime.code.search(project, "rust_anchor")).some((symbol) => symbol.path === "src/guide.rs")) throw new Error("Tree-sitter did not index Python and Rust syntax trees.");
  const graph = await runtime.code.graph(project, "sharedHelper");
  if (!graph.relationships.some((edge) => edge.kind === "IMPORTS" && edge.sourcePath === "src/searchable.ts" && edge.targetPath === "src/lib.ts" && edge.confidence === "confirmed")) throw new Error(`The Code Intelligence graph did not confirm and resolve the explicit TypeScript import: ${JSON.stringify({ graph, files: runtime.persistence.listCodeIndexFiles(project) })}`);
  if (!graph.relationships.some((edge) => edge.kind === "CALLS" && edge.sourceName === "ordercodeAnchorSymbol" && edge.targetName === "sharedHelper" && edge.targetPath === "src/lib.ts" && edge.confidence === "inferred")) throw new Error("The Code Intelligence graph did not report its inferred cross-file call relationship.");
  const focusedGraph = await runtime.code.graph(project, "ordercodeAnchorSymbol");
  if (!focusedGraph.relationships.some((edge) => edge.sourceName === "ordercodeAnchorSymbol") || focusedGraph.relationships.some((edge) => edge.sourceName === "unrelatedAnchorSymbol")) throw new Error("A symbol-focused graph query returned unrelated relationships from the same file.");
  if (!runtime.tools.list(project).some((tool) => tool.name === "code.graph" && tool.effects.includes("READ"))) throw new Error("The Code Intelligence graph was not exposed as a permission-gated read tool to agents.");
  await writeFile(join(project, "src", "many-call-sites.ts"), `import { sharedHelper } from './lib';\n${Array.from({ length: 45 }, (_, index) => `export function graphCaller${index}() { return sharedHelper(); }`).join("\n")}\n`);
  const graphTool = await runtime.invokeTool(directSession.id, "code.graph", { query: "sharedHelper" });
  const agentGraph = graphTool.data as { relationships?: unknown[]; truncated?: boolean } | undefined;
  if (!graphTool.ok || !JSON.stringify(graphTool.data).includes("src/lib.ts") || agentGraph?.relationships?.length !== 32 || agentGraph.truncated !== true || JSON.stringify(graphTool.data).length > 16_000) throw new Error("The agent-facing Code Intelligence graph tool did not return a compact, capped set of indexed relationships.");
  const textSearch = await runtime.code.search(project, "persistent unique needle");
  if (!textSearch.some((result) => result.kind === "text" && result.path === "src/searchable.ts" && result.line === 2)) throw new Error(`Code Intelligence did not return full-text matches with their source line: ${JSON.stringify(textSearch)}`);
  const expectedTextSearchSource = await hasRipgrep() ? "ripgrep" : "fts5";
  if (!textSearch.some((result) => result.source === expectedTextSearchSource)) throw new Error(`Code Intelligence did not identify its ${expectedTextSearchSource} text-search source: ${JSON.stringify(textSearch)}`);
  const ftsFallback = new CodeIntelligence(runtime.persistence, { ripgrepCommand: "ordercode-rg-intentionally-missing" });
  if (!(await ftsFallback.search(project, "persistent unique needle")).some((result) => result.kind === "text" && result.source === "fts5")) throw new Error("Code Intelligence did not fall back to its persistent FTS5 index when ripgrep was unavailable.");
  let compatibleAuthorization = "";
  const compatibleServer = createServer((request, response) => {
    compatibleAuthorization = request.headers.authorization ?? "";
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/models") response.end(JSON.stringify({ data: [{ id: "fixture-compatible-model" }] }));
    else if (request.url === "/v1/chat/completions") response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Compatible endpoint verified." }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } } }));
    else { response.statusCode = 404; response.end(JSON.stringify({ error: "not found" })); }
  });
  await new Promise<void>((resolveListen, rejectListen) => { compatibleServer.once("error", rejectListen); compatibleServer.listen(0, "127.0.0.1", resolveListen); });
  compatibleServer.unref();
  const compatibleAddress = compatibleServer.address();
  if (!compatibleAddress || typeof compatibleAddress === "string") throw new Error("The compatible endpoint fixture did not bind a local port.");
  const compatibleEndpoint = runtime.createCustomProvider({ label: "Fixture Compatible", baseUrl: `http://127.0.0.1:${compatibleAddress.port}/v1` });
  runtime.providers.setCredential(compatibleEndpoint.id, "fixture-compatible-key");
  const compatibleAdapter = runtime.providers.get(compatibleEndpoint.id);
  if (!compatibleAdapter) throw new Error("The custom compatible provider was not registered.");
  const compatibleModels = await compatibleAdapter.listModels();
  const compatibleTurn = await compatibleAdapter.complete({ model: "fixture-compatible-model", messages: [{ role: "user", content: "hello" }] });
  await new Promise<void>((resolveClose, rejectClose) => compatibleServer.close((error) => error ? rejectClose(error) : resolveClose()));
  if (compatibleModels[0]?.id !== "fixture-compatible-model" || compatibleModels[0]?.priceKind !== "unknown" || compatibleTurn.content !== "Compatible endpoint verified." || compatibleTurn.inputTokens !== 2 || compatibleTurn.cachedTokens !== 3 || compatibleAuthorization !== "Bearer fixture-compatible-key") throw new Error(`The compatible provider failed model discovery, authenticated completion, cached-token accounting, or unknown-price reporting: ${JSON.stringify({ compatibleModels, compatibleTurn, compatibleAuthorization })}`);
  let openRouterUsageRequested = false;
  const openRouterServer = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/models") response.end(JSON.stringify({ data: [{ id: "fixture-priced-model", pricing: { prompt: "0.000001", completion: "0.000002" } }] }));
      else if (request.url === "/v1/chat/completions") {
        const payload = JSON.parse(body) as { stream_options?: { include_usage?: boolean } };
        openRouterUsageRequested = payload.stream_options?.include_usage === true;
        response.setHeader("content-type", "text/event-stream");
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OpenRouter fixture." } }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 1 }, cost: 0.000004 } })}\n\n`);
        response.end("data: [DONE]\n\n");
      } else { response.statusCode = 404; response.end(JSON.stringify({ error: "not found" })); }
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => { openRouterServer.once("error", rejectListen); openRouterServer.listen(0, "127.0.0.1", resolveListen); });
  openRouterServer.unref();
  const openRouterAddress = openRouterServer.address();
  if (!openRouterAddress || typeof openRouterAddress === "string") throw new Error("The OpenRouter fixture did not bind a local port.");
  const openRouterFixture = new OpenAICompatibleProvider("openrouter", "OpenRouter fixture", `http://127.0.0.1:${openRouterAddress.port}/v1`, "fixture-openrouter-key");
  const pricedModels = await openRouterFixture.listModels();
  const pricedTurn = await openRouterFixture.stream({ model: "fixture-priced-model", messages: [{ role: "user", content: "hello" }], stream: true }, () => undefined);
  await new Promise<void>((resolveClose, rejectClose) => openRouterServer.close((error) => error ? rejectClose(error) : resolveClose()));
  const pricedModel = pricedModels.find((model) => model.id === "fixture-priced-model");
  if (pricedModel?.pricing?.inputPerMillionUsd !== 1 || pricedModel?.pricing?.outputPerMillionUsd !== 2 || pricedTurn.costUsd !== 0.000004 || pricedTurn.costKind !== "exact" || pricedTurn.cachedTokens !== 1 || !openRouterUsageRequested) throw new Error(`OpenRouter pricing, cached tokens, or streamed billing usage was not collected: ${JSON.stringify({ pricedModels, pricedTurn, openRouterUsageRequested })}`);
  let openCodeAuthorization = "";
  let openCodeCompletionPath = "";
  let openCodeInferenceCalls = 0;
  const openCodeServer = createServer((request, response) => {
    openCodeAuthorization = request.headers.authorization ?? "";
    response.setHeader("content-type", "application/json");
    if (request.url === "/zen/v1/models") response.end(JSON.stringify({ data: [
      { id: "big-pickle" }, { id: "deepseek-v4.1-flash-free" }, { id: "paid-chat" }, { id: "claude-fable-5" }, { id: "unverified-free-suffix-free" },
    ] }));
    else if (request.url === "/pricing") {
      response.setHeader("content-type", "text/html");
      response.end(`<table>${[["Big Pickle", "big-pickle"], ["DeepSeek V4.1 Flash Free", "deepseek-v4.1-flash-free"]].map(([label, id]) => `<tr><td>${label}</td><td>${id}</td><td>https://opencode.ai/inference/openai/v1/chat/completions</td><td>@ai-sdk/openai-compatible</td></tr><tr><td>${label}</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr>`).join("")}<tr><td>Paid Chat</td><td>paid-chat</td><td>https://opencode.ai/inference/openai/v1/chat/completions</td><td>@ai-sdk/openai-compatible</td></tr><tr><td>Paid Chat</td><td>$1.00</td><td>$2.00</td><td>-</td><td>-</td></tr></table>`);
    } else if (request.url === "/zen/v1/chat/completions") {
      openCodeInferenceCalls += 1;
      openCodeCompletionPath = request.url;
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Explicit paid OpenCode model verified." }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 5 } }));
    } else { response.statusCode = 404; response.end(JSON.stringify({ error: "not found" })); }
  });
  await new Promise<void>((resolveListen, rejectListen) => { openCodeServer.once("error", rejectListen); openCodeServer.listen(0, "127.0.0.1", resolveListen); });
  openCodeServer.unref();
  const openCodeAddress = openCodeServer.address();
  if (!openCodeAddress || typeof openCodeAddress === "string") throw new Error("The OpenCode fixture did not bind a local port.");
  const openCodeOrigin = `http://127.0.0.1:${openCodeAddress.port}`;
  const openCodeFixture = new OpenAICompatibleProvider("opencode_zen", "OpenCode", `${openCodeOrigin}/zen/v1`, "fixture-opencode-key", {}, false, `${openCodeOrigin}/zen/v1/models`, `${openCodeOrigin}/pricing`);
  try {
    const openCodeModels = await openCodeFixture.listModels();
    assert.deepEqual(openCodeModels.map((model) => model.id), ["big-pickle", "deepseek-v4.1-flash-free", "paid-chat"]);
    const restrictedModels = openCodeModels.filter((model) => model.priceKind === "free");
    assert.equal(restrictedModels.length, 2);
    for (const model of restrictedModels) {
      assert.equal(model.available, false);
      assert.equal(model.pricing?.inputPerMillionUsd, 0);
      assert.equal(model.pricing?.outputPerMillionUsd, 0);
      assert.match(model.availabilityReason ?? "", /OpenCode/);
    }
    assert.equal(openCodeModels.find((model) => model.id === "paid-chat")?.available, true);
    assert.equal(openCodeModels.find((model) => model.id === "paid-chat")?.priceKind, "unknown");
    const restricted = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "OPENCODE_FREE_TIER_RESTRICTED";
    await assert.rejects(openCodeFixture.complete({ model: "big-pickle", messages: [{ role: "user", content: "Must not reach inference" }] }), restricted);
    assert.equal(openCodeInferenceCalls, 0);
    openCodeFixture.setCredential(undefined);
    assert.equal(openCodeFixture.configured, false);
    await assert.rejects(openCodeFixture.complete({ model: "deepseek-v4.1-flash-free", messages: [{ role: "user", content: "Must not reach inference" }] }), restricted);
    await assert.rejects(openCodeFixture.complete({ model: "paid-chat", messages: [{ role: "user", content: "Needs a key" }] }), /not configured/);
    assert.equal(openCodeInferenceCalls, 0);
    openCodeFixture.setCredential("fixture-opencode-key");
    const openCodeTurn = await openCodeFixture.complete({ model: "paid-chat", messages: [{ role: "user", content: "Explicitly selected authenticated paid fixture" }] });
    assert.equal(openCodeInferenceCalls, 1);
    assert.equal(openCodeTurn.content, "Explicit paid OpenCode model verified.");
    assert.equal(openCodeAuthorization, "Bearer fixture-opencode-key");
    assert.equal(openCodeCompletionPath, "/zen/v1/chat/completions");
  } finally {
    openCodeServer.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => openCodeServer.close((error) => error ? rejectClose(error) : resolveClose()));
  }

  let insecureEndpointRejected = false;
  try { runtime.createCustomProvider({ label: "Insecure endpoint", baseUrl: "http://example.com/v1" }); } catch { insecureEndpointRejected = true; }
  if (!insecureEndpointRejected) throw new Error("A non-loopback HTTP custom provider endpoint was accepted.");
  const unchangedIndex = await runtime.code.index(project);
  if (unchangedIndex.updatedFiles !== 0) throw new Error("Code Intelligence rebuilt an unchanged file instead of reusing its index.");
  await writeFile(indexedFile, "import { sharedHelper } from './lib';\nexport function ordercodeAnchorSymbol() { return sharedHelper() + ' updated searchable phrase'; }\n");
  if ((await runtime.code.search(project, "persistent unique needle")).length) throw new Error("Code Intelligence returned stale full-text results after a file update.");
  if (!(await runtime.code.search(project, "updated searchable phrase")).some((result) => result.kind === "text")) throw new Error("Code Intelligence did not refresh full-text results after a file update.");

  const require = createRequire(import.meta.url);
  const mcpServerModule = pathToFileURL(require.resolve("@modelcontextprotocol/server")).href;
  const mcpStdioModule = pathToFileURL(require.resolve("@modelcontextprotocol/server/stdio")).href;
  const zodModule = pathToFileURL(require.resolve("zod")).href;
  const mcpFixture = `import { McpServer } from ${JSON.stringify(mcpServerModule)}; import { StdioServerTransport } from ${JSON.stringify(mcpStdioModule)}; import * as z from ${JSON.stringify(zodModule)}; const server = new McpServer({ name: "OrderCode smoke MCP", version: "1.0.0" }); server.registerTool("echo", { description: "Returns the submitted text.", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } }, async ({ text }) => ({ content: [{ type: "text", text: "echo:" + text }] })); await server.connect(new StdioServerTransport());`;
  const mcpServer = await runtime.mcp.save({ projectPath: project, name: "Smoke MCP", transport: "stdio", command: process.execPath, args: ["--input-type=module", "-e", mcpFixture], secretKeys: [], enabled: true });
  if (runtime.tools.list(project).some((tool) => tool.name.startsWith("mcp_"))) throw new Error("Unconnected MCP server tools were exposed to the agent.");
  const mcpStatus = await runtime.mcp.connect(mcpServer.id);
  if (!mcpStatus.connected || mcpStatus.toolCount !== 1 || mcpStatus.tools[0]?.name !== "echo") throw new Error("The MCP manager did not connect to a real stdio server and discover its tool.");
  const mcpDefinition = runtime.tools.list(project).find((tool) => tool.name.startsWith("mcp_"));
  if (!mcpDefinition || runtime.tools.list(join(project, "sibling")).some((tool) => tool.name === mcpDefinition.name)) throw new Error("MCP tools were exposed outside their configured workspace.");
  const mcpCall = { name: mcpDefinition.name, input: { text: "safe fixture" }, context: { sessionId: directSession.id, projectPath: project, agentId: "general", permissionProfile: "guided" as const, mode: "build" as const } };
  const mcpApprovalResult = await runtime.tools.invoke(mcpCall);
  const mcpApproval = (mcpApprovalResult.data as { permissionRequest?: { id: string; effect: string } }).permissionRequest;
  if (mcpApprovalResult.status !== "rejected" || !mcpApproval || mcpApproval.effect !== "EXECUTE") throw new Error("A local MCP tool call bypassed the permission engine.");
  await runtime.resolvePermission(mcpApproval.id, "once");
  const mcpToolResult = await runtime.tools.invoke(mcpCall);
  if (!mcpToolResult.ok || !JSON.stringify(mcpToolResult.data).includes("echo:safe fixture") || !JSON.stringify(mcpToolResult.data).includes("untrustedExternalResult")) throw new Error("The MCP tool result was not returned as untrusted data after explicit approval.");
  if (!await runtime.mcp.disconnect(mcpServer.id) || runtime.tools.list(project).some((tool) => tool.name === mcpDefinition.name)) throw new Error("Disconnecting an MCP server did not remove its live tools.");
  let insecureMcpUrlRejected = false;
  try { await runtime.mcp.save({ projectPath: project, name: "Insecure endpoint", transport: "streamable-http", endpoint: "http://example.com/mcp", secretKeys: [], enabled: true }); } catch { insecureMcpUrlRejected = true; }
  if (!insecureMcpUrlRejected) throw new Error("MCP Manager accepted a non-loopback remote endpoint without HTTPS.");

  const freeOnlySession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model", freeOnly: true });
  const blockedFreeOnly = await runtime.run({ sessionId: freeOnlySession.id, goal: "Do not send a paid or unverified inference." });
  if (blockedFreeOnly.state !== "WAITING_USER" || blockedFreeOnly.usage.providerCalls !== 0 || !blockedFreeOnly.reason?.includes("Free Only")) throw new Error("Free Only did not block an unverified model before inference.");
  const updatedFreeOnly = runtime.updateSession(freeOnlySession.id, { freeOnly: false });
  if (updatedFreeOnly.freeOnly !== false || runtime.getSession(freeOnlySession.id).freeOnly !== false) throw new Error("Free Only selection did not persist on the session.");
  const customAgent = runtime.agents.save({ name: "Evidence Reviewer", description: "Summarizes relevant evidence.", instructions: "Describe the relevant facts before conclusions.", toolAllowlist: ["fs.read"], enabled: true });
  const customSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model" });
  const customAgentRun = await runtime.run({ sessionId: customSession.id, goal: "agent-profile-smoke", agentId: customAgent.id });
  if (customAgentRun.state !== "COMPLETED") throw new Error("A custom Agent Studio profile could not run with its restricted toolset.");
  const customAgentTest = await runtime.testAgent(customSession.id, customAgent.id, "agent-test-smoke");
  if (customAgentTest.content !== "Agent test response with no tools." || customAgentTest.inputTokens !== 12 || customAgentTest.outputTokens !== 8 || customAgentTest.toolCallsIgnored) throw new Error("Agent Studio could not test a saved profile without executing tools.");
  let freeOnlyAgentTestBlocked = false;
  const unpricedAgentTestSession = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model", freeOnly: true });
  try { await runtime.testAgent(unpricedAgentTestSession.id, customAgent.id, "agent-test-smoke"); } catch { freeOnlyAgentTestBlocked = true; }
  if (!freeOnlyAgentTestBlocked) throw new Error("Free Only allowed an unverified model during an agent test.");
  const disabledAgent = runtime.agents.save({ name: "Disabled Reviewer", description: "", instructions: "Review only when enabled.", toolAllowlist: [], enabled: false });
  let disabledAgentRejected = false;
  try { await runtime.run({ sessionId: customSession.id, goal: "Must not run.", agentId: disabledAgent.id }); } catch { disabledAgentRejected = true; }
  if (!disabledAgentRejected) throw new Error("A disabled custom agent was allowed to run.");
  const session = runtime.createSession({ projectPath: project, mode: "build", permissionProfile: "guided", providerId: "fixture", modelId: "fixture-model" });
  const context = runtime.context.build({ goal: "a".repeat(20_000), projectPath: project, mode: "build", state: "RUNNING", maxChars: 4_000 });
  if (context.text.length > 4_000) throw new Error("Context construction exceeded its configured size.");
  const pendingRun = await runtime.run({ sessionId: session.id, goal: "Crea recovered.txt y conserva el resultado tras reiniciar." });
  if (pendingRun.state !== "WAITING_APPROVAL" || !pendingRun.pendingPermission) throw new Error("The agent did not pause for a write approval.");
  await runtime.close();

  runtime = await createHarnessRuntime({ dataDirectory: directory, providers: [fixtureProvider()] });
  if (!runtime.agents.get(customAgent.id)) throw new Error("Custom Agent Studio profiles did not survive a Harness restart.");
  if (!runtime.providers.get(compatibleEndpoint.id) || !runtime.providers.list().some((provider) => provider.id === compatibleEndpoint.id && provider.custom)) throw new Error("Custom compatible provider configuration did not survive a Harness restart.");
  if (!(await runtime.code.search(project, "updated searchable phrase")).some((result) => result.kind === "text" && result.path === "src/searchable.ts")) throw new Error("Code Intelligence did not restore its FTS5 index after a Harness restart.");
  if (!(await runtime.skills.list(project)).some((skill) => skill.id === skillPath && skill.enabled)) throw new Error("The selected project Skill did not survive a Harness restart.");
  const restoredRequest = runtime.permissions.getPending(session.id)[0];
  if (!restoredRequest || restoredRequest.id !== pendingRun.pendingPermission.id) throw new Error("A pending permission did not survive runtime restart.");
  const resumed = await runtime.resolvePermission(restoredRequest.id, "once");
  if (!("state" in resumed) || resumed.state !== "COMPLETED") throw new Error("The approved run did not resume to completion.");
  if (await readFile(join(project, "recovered.txt"), "utf8") !== "OrderCode durable approval") throw new Error("The resumed run did not write the requested file.");
  const restored = runtime.getSession(session.id);
  const messages = runtime.listMessages(session.id);
  const events = runtime.listEvents(session.id);
  if (restored.state !== "COMPLETED" || !messages.some((message) => message.content.includes("durable approval")) || !events.some((event) => event.type === "run.completed") || !events.some((event) => event.type === "provider.chunk")) {
    throw new Error("Session state, messages, or completion evidence did not persist.");
  }
  if (runtime.getSession(outputBudgetSession.id).budget?.maxOutputTokens !== 7) throw new Error("The configured session usage budget did not survive a Harness restart.");
  const restoredUsage = runtime.getUsageAnalytics({ projectPath: project, days: 0, sessionId: usageSession.id });
  if (restoredUsage.providerCalls !== 2 || restoredUsage.measuredCalls !== 2 || restoredUsage.inputTokens !== 29 || restoredUsage.outputTokens !== 12 || restoredUsage.estimatedSavedTokens !== measuredUsage.estimatedSavedTokens + 4) throw new Error("Usage totals or estimated savings did not survive a Harness restart.");
  migrationPersistence = new SqlitePersistence(migrationDirectory);
  const legacySession = migrationPersistence.createSession({ id: "legacy-session", projectPath: migrationDirectory, title: "Legacy usage", mode: "build", permissionProfile: "guided", state: "COMPLETED" });
  const legacyAt = new Date().toISOString();
  const legacyEvent: HarnessEvent = { protocol: 1, id: "legacy-run-event", sessionId: legacySession.id, runId: "legacy-run", sequence: 1, createdAt: legacyAt, type: "run.completed", payload: { result: { session: { providerId: "legacy-provider", modelId: "legacy-model" }, usage: { providerCalls: 2, inputTokens: 81, outputTokens: 22, cachedTokens: 8 } } } };
  migrationPersistence.appendEvent(legacyEvent);
  migrationPersistence.close();
  migrationPersistence = undefined;
  const oldVersionDatabase = new DatabaseSync(join(migrationDirectory, "runtime.sqlite3"));
  oldVersionDatabase.exec("PRAGMA user_version = 7;");
  oldVersionDatabase.close();
  migrationPersistence = new SqlitePersistence(migrationDirectory);
  const migratedUsage = migrationPersistence.getUsageAnalytics({ projectPath: migrationDirectory, days: 0 });
  if (migratedUsage.providerCalls !== 2 || migratedUsage.legacyCalls !== 2 || migratedUsage.measuredCalls !== 0 || migratedUsage.inputTokens !== 81 || migratedUsage.outputTokens !== 22 || migratedUsage.cachedTokens !== 8 || migratedUsage.savingsCalls !== 0 || migratedUsage.untrackedSavingsCalls !== 2) throw new Error("The usage upgrade did not restore evidence-backed legacy totals while leaving old token savings unknown.");
  migrationPersistence.close();
  migrationPersistence = new SqlitePersistence(migrationDirectory);
  if (migrationPersistence.getUsageAnalytics({ projectPath: migrationDirectory, days: 0 }).providerCalls !== 2) throw new Error("Reopening an upgraded usage database duplicated legacy provider calls.");
  migrationPersistence.close();
  migrationPersistence = undefined;
  process.stdout.write(JSON.stringify({ ok: true, sessionId: session.id, events: events.length, checks: ["approval", "git-status-stage-unstage-diff-commit-branch-tag", "publish-approval", "vercel-hook-validation-job-response-and-publish-approval", "same-model-read-only-specialist-delegation-and-durable-activity", "session-budget-persistence-output-cap-input-overrun-tool-stop-duration-and-cost-safety", "usage-ledger-unknown-metrics-estimated-savings-idempotency-agent-aggregation-restart", "usage-ledger-legacy-migration-idempotency", "project-skills-context-persistence", "agent-studio-profile-persistence-tool-restrictions-and-dry-run", "mcp-stdio-discovery-permission-and-disconnect", "persistent-incremental-code-index", "ripgrep-live-text-search-and-fts5-fallback", "custom-compatible-provider-auth-model-discovery-persistence-and-free-only-safety", "tree-sitter-typescript-python-rust-and-resolved-code-graph", "free-only-verified-pricing", "openrouter-current-pricing-streamed-cost-and-cost-budget-enforcement", "opencode-restricted-free-catalog-no-inference-and-explicit-authenticated-paid-chat", "plan-read-only", "path-scope", "interactive-pty-auth", "context-budget", "stream-event", "restart-recovery", "durable-result"] }) + "\n");
} finally {
  await runtime.close();
  await costRuntime?.close();
  migrationPersistence?.close();
  await Promise.all([rm(directory, { recursive: true, force: true }), rm(project, { recursive: true, force: true }), rm(costDirectory, { recursive: true, force: true }), rm(migrationDirectory, { recursive: true, force: true })]);
}
