import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { harnessRpcRequestSchema } from '@ordercode/shared';
import type {
  BrokerHealth,
  AgentProfile,
  AgentToolChoice,
  AgentTestResult,
  McpServer,
  McpServerStatus,
  McpCatalogEntry,
  CodeGraphResult,
  CodeSymbol,
  ExecutionBudget,
  HarnessEvent,
  PermissionEvaluation,
  PermissionDecision,
  PermissionProfile,
  SessionConfig,
  SessionRecord,
  TerminalSessionInfo,
  UsageAnalytics,
  WorkspaceEntry,
  WorkMode,
} from './contracts';

const isTauri = () => typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
export const isDesktopApp = isTauri;
const fallbackHealth: BrokerHealth = { ok: false, version: 'browser-preview', platform: typeof navigator === 'undefined' ? 'browser' : navigator.platform, harnessConnected: false };

type RpcEnvelope<T = unknown> = { result?: T; error?: { message?: string; data?: { message?: string } } };
type HarnessSession = { id: string; projectPath: string; title: string; modelId?: string; providerId?: string; freeOnly?: boolean; budget?: SessionRecord['budget']; mode: string; permissionProfile: string; state: string; createdAt: string; updatedAt: string; sequence: number };

export async function listCustomAgents(): Promise<AgentProfile[]> { return rpc<AgentProfile[]>('agents.list'); }
export async function listAvailableAgentTools(sessionId?: string): Promise<AgentToolChoice[]> { return rpc<AgentToolChoice[]>('tools.list', sessionId ? { sessionId } : {}); }
export async function saveCustomAgent(profile: { id?: string; name: string; description: string; instructions: string; toolAllowlist: string[]; enabled: boolean }): Promise<AgentProfile> {
  return rpc<AgentProfile>('agents.save', { profile });
}
export async function deleteCustomAgent(agentId: string): Promise<boolean> { return rpc<boolean>('agents.delete', { agentId }); }
export async function testCustomAgent(sessionId: string, agentId: string, prompt: string): Promise<AgentTestResult> {
  return rpc<AgentTestResult>('agents.test', { sessionId, agentId, prompt });
}

export async function listMcpServers(sessionId: string): Promise<McpServerStatus[]> { return rpc<McpServerStatus[]>('mcp.list', { sessionId }); }
export async function saveMcpServer(server: { id?: string; projectPath: string; name: string; transport: McpServer['transport']; command?: string; args?: string[]; endpoint?: string; secretKeys: string[]; enabled: boolean; marketplace?: McpServer['marketplace'] }): Promise<McpServer> { return rpc<McpServer>('mcp.save', { server }); }
export async function connectMcpServer(serverId: string): Promise<McpServerStatus> { return rpc<McpServerStatus>('mcp.connect', { serverId }); }
export async function disconnectMcpServer(serverId: string): Promise<boolean> { return rpc<boolean>('mcp.disconnect', { serverId }); }
export async function deleteMcpServer(serverId: string): Promise<boolean> { return rpc<boolean>('mcp.delete', { serverId }); }
export async function configureMcpCredentials(serverId: string, credentials: Record<string, string>): Promise<void> { await rpc<boolean>('mcp.credentials.configure', { serverId, credentials }); }
export async function setMcpServerSecret(serverId: string, secretKey: string, value: string): Promise<void> {
  if (!isTauri()) throw new Error('Las credenciales MCP requieren el almacén seguro de OrderCode Desktop.');
  await invoke<void>('mcp_server_secret_set', { serverId, secretKey, value });
}
export async function removeMcpServerSecret(serverId: string, secretKey: string): Promise<void> {
  if (!isTauri()) throw new Error('Las credenciales MCP requieren el almacén seguro de OrderCode Desktop.');
  await invoke<void>('mcp_server_secret_remove', { serverId, secretKey });
}
export async function mcpServerSecretStatus(serverId: string, secretKeys: string[]): Promise<Record<string, boolean>> {
  if (!isTauri()) return {};
  return invoke<Record<string, boolean>>('mcp_server_secret_status', { serverId, secretKeys });
}
export async function searchMcpMarketplace(sessionId: string, query: string): Promise<McpCatalogEntry[]> { return rpc<McpCatalogEntry[]>('marketplace.search', { sessionId, query }); }
export async function installMcpMarketplaceEntry(sessionId: string, serverName: string, packageVersion: string): Promise<McpServer> {
  return rpc<McpServer>('marketplace.install', { sessionId, serverName, packageVersion });
}

export async function configureVercelDeployHook(projectPath: string, url: string): Promise<void> {
  if (!isTauri()) throw new Error('Los Deploy Hooks solo están disponibles en OrderCode Desktop.');
  await invoke<void>('release_hook_set', { projectPath, url });
}

export async function removeVercelDeployHook(projectPath: string): Promise<void> {
  if (!isTauri()) throw new Error('Los Deploy Hooks solo están disponibles en OrderCode Desktop.');
  await invoke<void>('release_hook_remove', { projectPath });
}

export async function vercelDeployHookStatus(projectPath: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('release_hook_status', { projectPath });
}

function profileId(profile: PermissionProfile): string {
  return ({ Lectura: 'reading', Guiado: 'guided', Auto: 'auto', Avanzado: 'advanced' })[profile];
}

function modelSelection(model: string, explicitProvider?: string, explicitModel?: string): { providerId?: string; modelId?: string } {
  const separator = model.indexOf('::');
  if (separator > 0) return { providerId: model.slice(0, separator), modelId: model.slice(separator + 2) };
  if (explicitProvider) return { providerId: explicitProvider, modelId: explicitModel || model };
  if (model.startsWith('Ollama · ')) return { providerId: 'ollama', modelId: model.slice('Ollama · '.length) };
  if (model.startsWith('LM Studio · ')) return { providerId: 'lmstudio', modelId: model.slice('LM Studio · '.length) };
  if (model.startsWith('Claude ')) return { providerId: 'anthropic', modelId: model };
  if (model.startsWith('Gemini ')) return { providerId: 'gemini', modelId: model };
  if (model.startsWith('Grok ')) return { providerId: 'xai', modelId: model };
  if (!model.trim()) return {};
  return { providerId: 'openai', modelId: model };
}

function desktopBudget(value: unknown, fallback?: ExecutionBudget): ExecutionBudget {
  const raw = value && typeof value === 'object' ? value as Partial<ExecutionBudget> : fallback;
  return {
    maxInputTokens: raw?.maxInputTokens ?? null,
    maxOutputTokens: raw?.maxOutputTokens ?? null,
    maxCostUsd: raw?.maxCostUsd ?? null,
    maxDurationMs: raw?.maxDurationMs ?? null,
    maxToolCalls: raw?.maxToolCalls ?? null,
  };
}

function toDesktopSession(value: Record<string, unknown>, fallback: SessionRecord): SessionRecord {
  const modeMap: Record<string, SessionRecord['mode']> = { plan: 'Plan', build: 'Build', auto: 'Auto', Plan: 'Plan', Build: 'Build', Auto: 'Auto' };
  const permissionMap: Record<string, SessionRecord['permission']> = { reading: 'Lectura', guided: 'Guiado', auto: 'Auto', advanced: 'Avanzado', Lectura: 'Lectura', Guiado: 'Guiado', Avanzado: 'Avanzado' };
  return {
    ...fallback,
    id: typeof value.id === 'string' ? value.id : fallback.id,
    projectPath: typeof value.projectPath === 'string' ? value.projectPath : fallback.projectPath,
    model: typeof value.modelId === 'string' ? value.modelId : fallback.model,
    providerId: typeof value.providerId === 'string' ? value.providerId : fallback.providerId,
    freeOnly: typeof value.freeOnly === 'boolean' ? value.freeOnly : fallback.freeOnly ?? false,
    budget: desktopBudget(value.budget, fallback.budget),
    mode: modeMap[String(value.mode)] ?? fallback.mode,
    permission: permissionMap[String(value.permissionProfile)] ?? fallback.permission,
    state: typeof value.state === 'string' ? value.state as SessionRecord['state'] : fallback.state,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : fallback.createdAt,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    sequence: typeof value.sequence === 'number' ? value.sequence : 0,
  };
}

async function call<T>(command: string, args: Record<string, unknown>, browserValue: T): Promise<T> {
  if (!isTauri()) return browserValue;
  return invoke<T>(command, args);
}

async function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) throw new Error('El runtime requiere la aplicación de escritorio de OrderCode.');
  const request = harnessRpcRequestSchema.parse({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params });
  const response = await invoke<RpcEnvelope<T>>('harness_request', {
    request,
  });
  if (response.error) throw new Error(response.error.data?.message ?? response.error.message ?? `Error del Harness en ${method}.`);
  if (!Object.prototype.hasOwnProperty.call(response, 'result')) throw new Error(`El Harness no devolvió un resultado para ${method}.`);
  return response.result as T;
}

export function health(): Promise<BrokerHealth> { return call('health', {}, fallbackHealth); }

export type NativeUpdateMetadata = { version: string; currentVersion: string; notes?: string | null; publishedAt?: string | null };
export function updaterCheck(): Promise<NativeUpdateMetadata | null> {
  if (!isTauri()) return Promise.reject(new Error('La comprobación automática está disponible en OrderCode Desktop.'));
  return invoke<NativeUpdateMetadata | null>('updater_check');
}
export function updaterDownload(): Promise<number> {
  if (!isTauri()) return Promise.reject(new Error('La descarga de actualizaciones requiere OrderCode Desktop.'));
  return invoke<number>('updater_download');
}
export function updaterInstall(editorDirty: boolean): Promise<void> {
  if (!isTauri()) return Promise.reject(new Error('La instalación automática requiere OrderCode Desktop.'));
  return invoke<void>('updater_install', { editorDirty });
}

export async function pickWorkspaceFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) throw new Error('El selector de carpetas está disponible en OrderCode Desktop.');
  const selected = await open({ directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) });
  return typeof selected === 'string' ? selected : null;
}

export async function startHarness(workspacePath?: string): Promise<BrokerHealth> {
  const value = await call<BrokerHealth>('harness_start', workspacePath ? { workspacePath } : {}, fallbackHealth);
  if (isTauri() && !value.harnessConnected) throw new Error('El proceso Harness no confirmó la conexión.');
  return value;
}

export async function listSessions(): Promise<SessionRecord[]> {
  if (!isTauri()) return [];
  const values = await rpc<HarnessSession[]>('session.list');
  return values.map((item) => toDesktopSession(item as unknown as Record<string, unknown>, {
    id: item.id, projectPath: item.projectPath, model: item.modelId ?? '', providerId: item.providerId ?? '', freeOnly: item.freeOnly ?? false, budget: item.budget, mode: 'Build', permission: 'Guiado', createdAt: item.createdAt, state: item.state as SessionRecord['state'], sequence: item.sequence,
  }));
}

export async function loadUsageAnalytics(query: { projectPath: string; days: 7 | 30 | 90 | 0; sessionId?: string; modelId?: string }): Promise<UsageAnalytics> {
  return rpc<UsageAnalytics>('usage.analytics', query);
}

export async function createSession(config: SessionConfig): Promise<SessionRecord> {
  const selection = modelSelection(config.model, config.providerId, config.modelId);
  const fallback: SessionRecord = { ...config, freeOnly: config.freeOnly ?? false, model: selection.modelId ?? config.model, providerId: selection.providerId ?? '', id: `preview-${crypto.randomUUID()}`, createdAt: new Date().toISOString(), state: 'CREATED', sequence: 0 };
  if (!isTauri()) return fallback;
  const started = await startHarness(config.projectPath);
  if (!started.harnessConnected) throw new Error('El Harness no está disponible.');
  const projectPath = await call<string>('workspace_open', { projectPath: config.projectPath }, config.projectPath);
  const value = await rpc<HarnessSession>('session.create', {
    projectPath,
    title: projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'OrderCode',
    mode: config.mode.toLowerCase(),
    permissionProfile: profileId(config.permission),
    freeOnly: config.freeOnly ?? false,
    budget: config.budget,
    ...selection,
  });
  const session = toDesktopSession(value as unknown as Record<string, unknown>, fallback);
  await activateSession(session);
  return session;
}

export async function activateSession(session: SessionRecord): Promise<void> {
  if (!isTauri()) return;
  await call<unknown>('activate_session', { sessionId: session.id, projectPath: session.projectPath, mode: session.mode, permission: session.permission }, null);
}

export async function loadSession(sessionId: string): Promise<{ session: SessionRecord; messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>; events: HarnessEvent[]; pendingPermissions: Array<Record<string, unknown>> }> {
  const raw = await rpc<HarnessSession>('session.get', { sessionId });
  const fallback: SessionRecord = { id: sessionId, projectPath: raw.projectPath, model: raw.modelId ?? '', providerId: raw.providerId ?? '', freeOnly: raw.freeOnly ?? false, budget: raw.budget, mode: 'Build', permission: 'Guiado', createdAt: raw.createdAt, state: 'CREATED', sequence: raw.sequence };
  const [messages, events, pendingRequests] = await Promise.all([
    rpc<Array<{ id: string; role: string; content: string; createdAt: string }>>('session.messages', { sessionId, limit: 200 }),
    rpc<Array<Record<string, unknown>>>('session.events', { sessionId, afterSequence: Math.max(0, raw.sequence - 500) }),
    pendingPermissions(sessionId),
  ]);
  return {
    session: toDesktopSession(raw as unknown as Record<string, unknown>, fallback),
    messages: messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => ({ id: message.id, role: message.role as 'user' | 'assistant', content: message.content, createdAt: message.createdAt })),
    events: events.map(toDesktopEvent),
    pendingPermissions: pendingRequests,
  };
}

export async function loadSessionEvents(sessionId: string, afterSequence: number): Promise<HarnessEvent[]> {
  const events = await rpc<Array<Record<string, unknown>>>('session.events', { sessionId, afterSequence });
  return events.map(toDesktopEvent);
}

function toDesktopEvent(event: Record<string, unknown>): HarnessEvent {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
  const rawState = typeof payload.state === 'string' ? payload.state : event.type === 'run.completed' ? 'COMPLETED' : event.type === 'run.failed' ? 'FAILED' : event.type === 'permission.requested' ? 'WAITING_APPROVAL' : 'RUNNING';
  const request = payload.request && typeof payload.request === 'object' ? payload.request as Record<string, unknown> : undefined;
  const input = payload.input && typeof payload.input === 'object' ? payload.input as Record<string, unknown> : undefined;
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : undefined;
  const result = payload.result && typeof payload.result === 'object' ? payload.result as Record<string, unknown> : undefined;
  const resultData = result?.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
  const deployment = typeof resultData.jobId === 'string' ? resultData : undefined;
  const usage = payload.result && typeof payload.result === 'object' && (payload.result as Record<string, unknown>).usage && typeof (payload.result as Record<string, unknown>).usage === 'object' ? (payload.result as Record<string, unknown>).usage as Record<string, unknown> : undefined;
  const cost = typeof usage?.costUsd === 'number' && Number.isFinite(usage.costUsd)
    ? `${usage.costKind === 'exact' ? 'coste informado' : 'coste estimado'} $${usage.costUsd.toFixed(6)}`
    : 'coste desconocido';
  const cachedTokens = Number(usage?.cachedTokens ?? 0);
  const usageDetail = usage ? `${Number(usage.inputTokens ?? 0).toLocaleString()} tokens entrada${cachedTokens > 0 ? ` · ${cachedTokens.toLocaleString()} en caché` : ''} · ${Number(usage.outputTokens ?? 0).toLocaleString()} salida · ${Number(usage.providerCalls ?? 0)} llamadas · ${Number(usage.durationMs ?? 0)} ms · ${cost}` : undefined;
  const resultSummary = typeof result?.summary === 'string' ? result.summary : undefined;
  const delegatedRole = typeof resultData.role === 'string' ? resultData.role : undefined;
  const actionDetail = resultSummary ? `${delegatedRole ? `${delegatedRole} · ` : ''}${resultSummary}` : undefined;
  return {
    id: String(event.id ?? crypto.randomUUID()), sessionId: String(event.sessionId ?? ''), sequence: Number(event.sequence ?? 0), state: rawState as HarnessEvent['state'],
    summary: event.type === 'permission.requested' ? `Autorización: ${toolName ?? String(request?.toolName ?? 'acción')}` : toolName ? `${toolName}${result ? ` · ${String(result.status ?? '')}` : ''}` : String(event.type ?? 'Actividad'),
    ...(usageDetail ? { detail: usageDetail } : {}),
    ...(actionDetail ? { detail: actionDetail } : {}),
    ...(event.type === 'tool.started' && toolName === 'agents.delegate' && input ? { detail: `${String(input.role ?? 'specialist')} · ${String(input.task ?? '')}` } : {}),
    ...(request ? { detail: typeof request.reason === 'string' ? request.reason : `${String(request.action ?? '')} · ${String(request.resource ?? '')}`, permissionRequest: request } : {}),
    ...(resultData.path && typeof resultData.path === 'string' ? { changedFiles: [resultData.path] } : {}),
    ...(typeof resultData.diff === 'string' ? { diff: resultData.diff } : {}),
    ...(typeof resultData.stdout === 'string' || typeof resultData.stderr === 'string' ? { terminalOutput: [resultData.stdout, resultData.stderr].filter((part): part is string => typeof part === 'string' && !!part).join('\n') } : {}),
    ...(result?.toolName === 'release.deploy' && deployment ? { detail: `Trabajo ${deployment.jobId} · ${String(deployment.state ?? 'pendiente')} · build remoto aún en curso.` } : {}),
    ...(event.type === 'provider.chunk' && typeof payload.chunk === 'string' ? { detail: payload.chunk, summary: 'provider.chunk' } : {}),
    ...(typeof payload.error === 'string' ? { detail: payload.error } : {}),
    ...(typeof payload.reason === 'string' ? { detail: payload.reason } : {}),
    ...(typeof event.runId === 'string' ? { runId: event.runId } : {}),
  };
}

export async function sendSessionMessage(sessionId: string, message: string, mode: WorkMode, model: string, permission: PermissionProfile, providerId?: string, agentId?: string, freeOnly = false): Promise<HarnessEvent> {
  if (!isTauri()) return { id: crypto.randomUUID(), sessionId, sequence: 0, state: 'WAITING_USER', summary: 'Disponible en la app de escritorio', detail: 'El navegador solo muestra la vista previa. Para ejecutar tareas, abre OrderCode Desktop.' };
  const selection = modelSelection(model, providerId);
  const value = await rpc<Record<string, unknown>>('run', { sessionId, goal: message, mode: mode.toLowerCase(), permissionProfile: profileId(permission), freeOnly, ...(agentId ? { agentId } : {}), ...selection });
  const state = typeof value.state === 'string' ? value.state as HarnessEvent['state'] : 'FAILED';
  const assistant = value.assistantMessage && typeof value.assistantMessage === 'object' ? value.assistantMessage as Record<string, unknown> : undefined;
  const pending = value.pendingPermission && typeof value.pendingPermission === 'object' ? value.pendingPermission as Record<string, unknown> : undefined;
  const results = Array.isArray(value.toolResults) ? value.toolResults.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : [];
  const changedFiles = results.flatMap((item) => { const data = item.data && typeof item.data === 'object' ? item.data as Record<string, unknown> : {}; return item.toolName === 'fs.write' && typeof data.path === 'string' ? [data.path] : []; });
  const terminalOutput = results.filter((item) => item.toolName === 'process.exec').map((item) => { const data = item.data && typeof item.data === 'object' ? item.data as Record<string, unknown> : {}; return [data.stdout, data.stderr].filter((part): part is string => typeof part === 'string' && !!part).join('\n'); }).filter(Boolean).join('\n');
  const reason = typeof value.reason === 'string' ? value.reason : undefined;
  const detail = typeof assistant?.content === 'string' && assistant.content ? assistant.content : pending ? 'El Harness espera la decisión sobre la operación indicada.' : reason;
  return {
    id: String(value.runId ?? crypto.randomUUID()), sessionId, sequence: 0, state,
    summary: state === 'COMPLETED' ? 'Ejecución completada' : state === 'WAITING_APPROVAL' ? 'Autorización necesaria' : state === 'WAITING_USER' ? 'Configuración necesaria' : state === 'FAILED' ? 'Ejecución fallida' : state.replaceAll('_', ' '),
    ...(detail ? { detail } : {}), ...(pending ? { requiresApproval: true, permissionRequest: pending } : {}),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}), ...(changedFiles.length ? { changedFiles } : {}), ...(terminalOutput ? { terminalOutput } : {}),
  };
}

export function resolvePermission(requestId: string, decision: PermissionDecision): Promise<unknown> {
  return rpc('permission.resolve', { requestId, decision });
}

export function openNativeTerminal(sessionId: string, projectPath: string, authorizationId: string, shell = 'default', cols = 100, rows = 24): Promise<TerminalSessionInfo> {
  if (!isTauri()) return Promise.reject(new Error('La terminal interactiva está disponible en OrderCode Desktop.'));
  return invoke<TerminalSessionInfo>('terminal_open', { sessionId, projectPath, authorizationId, shell, cols, rows });
}
export function writeNativeTerminal(sessionId: string, terminalId: string, data: string): Promise<void> {
  return invoke<void>('terminal_write', { sessionId, terminalId, data });
}
export function resizeNativeTerminal(sessionId: string, terminalId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>('terminal_resize', { sessionId, terminalId, cols, rows });
}
export function closeNativeTerminal(sessionId: string, terminalId: string): Promise<void> {
  return invoke<void>('terminal_close', { sessionId, terminalId });
}

export function pendingPermissions(sessionId?: string): Promise<Array<Record<string, unknown>>> {
  return rpc('permission.pending', sessionId ? { sessionId } : {});
}

export function invokeHarnessTool(sessionId: string, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return rpc('tool.invoke', { sessionId, name, input });
}

export function cancelSession(sessionId: string): Promise<{ cancelled: boolean }> {
  return rpc('session.cancel', { sessionId });
}

export function checkPermission(permission: PermissionProfile, effect: string, target: string): Promise<PermissionEvaluation> {
  return call('check_permission', { profile: permission, effect, target }, {
    allowed: false, requiresApproval: effect !== 'READ', reason: 'La autorización real se solicita al ejecutar la acción.', effect,
  });
}

export function readFile(path: string): Promise<string> {
  if (!isTauri()) return Promise.reject(new Error('La lectura de archivos está disponible en la app de escritorio.'));
  return call('read_file', { path }, '');
}

export function workspaceTree(): Promise<WorkspaceEntry[]> { return call('workspace_tree', {}, []); }
export function gitStatus(): Promise<string> { return call('git_status', {}, ''); }

export async function searchCode(sessionId: string, query: string): Promise<CodeSymbol[]> {
  const value = await rpc<CodeSymbol[]>('code.search', { sessionId, query });
  return Array.isArray(value) ? value : [];
}

export async function searchCodeGraph(sessionId: string, query: string): Promise<CodeGraphResult> {
  return rpc<CodeGraphResult>('code.graph', { sessionId, query });
}

export type ProjectSkill = { id: string; name: string; description: string; enabled: boolean; resources: string[] };
export async function listProjectSkills(sessionId: string): Promise<ProjectSkill[]> {
  const value = await rpc<ProjectSkill[]>('skills.list', { sessionId });
  return Array.isArray(value) ? value : [];
}
export async function setProjectSkillEnabled(sessionId: string, skillId: string, enabled: boolean): Promise<ProjectSkill[]> {
  const value = await rpc<ProjectSkill[]>('skills.setEnabled', { sessionId, skillId, enabled });
  return Array.isArray(value) ? value : [];
}
export async function readProjectSkill(sessionId: string, skillId: string): Promise<{ id: string; content: string; sha256: string }> { return rpc('skills.read', { sessionId, skillId }); }

export function writeFile(path: string, content: string): Promise<boolean> {
  if (!isTauri()) return Promise.reject(new Error('La escritura de archivos está disponible en la app de escritorio.'));
  return call('write_file', { path, content }, false);
}

export function executeAllowed(command: string, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!isTauri()) return Promise.reject(new Error('La terminal está disponible en la app de escritorio.'));
  return call('exec_allowed', { command, cwd }, { code: -1, stdout: '', stderr: 'Runtime no disponible.' });
}

export type ProviderInfo = { id: string; label: string; baseUrl: string; configured: boolean; custom?: boolean };
export type ProviderModel = { id: string; providerId: string; label: string; capabilities: string[]; available: boolean; priceKind: 'free' | 'paid' | 'unknown' | 'local' | 'subscription'; pricing?: { inputPerMillionUsd: number; outputPerMillionUsd: number; updatedAt: string } };
export function listProviders(): Promise<ProviderInfo[]> { return rpc('providers.list'); }
export function listProviderModels(providerId: string): Promise<ProviderModel[]> { return rpc('provider.models', { providerId }); }
export function providerKeysStatus(providerIds: string[] = []): Promise<Record<string, boolean>> { return call('provider_keys_status', { providerIds }, {}); }
export type ChatGPTAccountStatus = { connected: boolean; email?: string | null };
export function chatgptAccountStatus(): Promise<ChatGPTAccountStatus> { return call('chatgpt_account_status', {}, { connected: false }); }
export async function connectChatGPT(): Promise<ChatGPTAccountStatus> {
  if (!isTauri()) throw new Error('La conexión con ChatGPT está disponible en la aplicación de escritorio.');
  const status = await invoke<ChatGPTAccountStatus>('chatgpt_connect');
  window.dispatchEvent(new Event('ordercode:providers-updated'));
  return status;
}
export async function disconnectChatGPT(): Promise<ChatGPTAccountStatus> {
  if (!isTauri()) throw new Error('La conexión con ChatGPT se gestiona desde la aplicación de escritorio.');
  const status = await invoke<ChatGPTAccountStatus>('chatgpt_disconnect');
  window.dispatchEvent(new Event('ordercode:providers-updated'));
  return status;
}
export function createCompatibleProvider(label: string, baseUrl: string): Promise<ProviderInfo> { return rpc('provider.custom.create', { label, baseUrl }); }
export async function deleteCompatibleProvider(providerId: string): Promise<boolean> {
  await removeProviderCredential(providerId);
  return rpc('provider.custom.delete', { providerId });
}
export async function setProviderCredential(providerId: string, apiKey: string): Promise<void> {
  if (!isTauri()) throw new Error('Las credenciales se guardan desde la aplicación de escritorio.');
  await invoke<void>('provider_set_key', { providerId, apiKey });
  await rpc('provider.configure', { providerId, apiKey });
  window.dispatchEvent(new Event('ordercode:providers-updated'));
}
export async function removeProviderCredential(providerId: string): Promise<void> {
  if (!isTauri()) throw new Error('Las credenciales se gestionan desde la aplicación de escritorio.');
  await invoke<void>('provider_remove_key', { providerId });
  await rpc('provider.configure', { providerId, apiKey: null });
  window.dispatchEvent(new Event('ordercode:providers-updated'));
}

export async function updateSession(session: SessionRecord): Promise<void> {
  await rpc('session.update', { sessionId: session.id, patch: { mode: session.mode.toLowerCase(), permissionProfile: profileId(session.permission), freeOnly: session.freeOnly ?? false, budget: session.budget, ...modelSelection(session.model, session.providerId) } });
}
