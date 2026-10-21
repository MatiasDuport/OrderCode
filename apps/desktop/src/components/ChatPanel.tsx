import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Bot, Check, ChevronDown, CircleDashed, FileCode2, Search, Send, ShieldCheck, Square, FolderOpen, X, CircleHelp, Layers3, ExternalLink, Gauge, WandSparkles, ListChecks, Code2, ChartNoAxesCombined, Infinity as InfinityIcon } from 'lucide-react';
import { cancelSession, compactSessionContext, createSession, health, isDesktopApp, listCustomAgents, listProviders, listProviderModels, loadUsageAnalytics, openExternalUrl, pickWorkspaceFolder, sendSessionMessage, updateSession } from '../lib/ipc';
import { followSessionOperation } from '../lib/sessionExecution';
import { useComposerDraftStore, useDesktopStore, type ChatMessage } from '../lib/store';
import type { AgentProfile, PermissionProfile, SessionRecord, WorkMode } from '../lib/contracts';
import type { ProviderInfo, ProviderModel } from '../lib/ipc';
import { ModelPicker } from './ModelPicker';
import { ChatMarkdown } from './ChatMarkdown';
import { TaskActivity } from './TaskActivity';
import { activityStateLabels as stateLabels } from '../lib/taskActivity';
import { shortModelLabel } from '../lib/modelCatalog';
import { OFFICIAL_AGENTS } from '../lib/agents';
import { AnchoredPopover, Dropdown, DropdownOption, Kbd, StatusDot } from './ui';
import { Localized } from '../lib/localization';
import orderCodeMark from '../../../../brand/LogoSinFondo.png';

const modes: Array<{ name: WorkMode; description: string }> = [
  { name: 'Auto', description: 'OrderCode decide el siguiente paso por ti' },
  { name: 'Plan', description: 'Preparar un plan antes de cambiar archivos' },
  { name: 'Build', description: 'Realizar los cambios y comprobar el resultado' },
];
const permissions: Array<{ name: PermissionProfile; description: string }> = [
  { name: 'Lectura', description: 'Solo consultar archivos' },
  { name: 'Guiado', description: 'Solicitar autorización para cambios y comandos' },
  { name: 'Auto', description: 'Permitir acciones seguras; pedir autorización para acciones sensibles' },
  { name: 'Avanzado', description: 'Permisos amplios dentro del workspace' },
];
const effortLabels: Record<string, string> = { none: 'Sin esfuerzo adicional', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo' };
const effortLabel = (value: string) => effortLabels[value] ?? value;

function linkedMessageContent(content: string, onLinkError: (error: unknown) => void): ReactNode {
  const matches = [...content.matchAll(/https?:\/\/[^\s<>"']+/gi)];
  if (!matches.length) return content;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    const raw = match[0];
    const start = match.index ?? 0;
    let end = raw.length;
    while (end > 0 && /[.,!?;:)}\]]/.test(raw[end - 1]!)) end -= 1;
    const candidate = raw.slice(0, end);
    let href: string | undefined;
    try { const url = new URL(candidate); if (url.protocol === 'http:' || url.protocol === 'https:') href = url.href; } catch { /* Leave malformed links as plain text. */ }
    if (!href) continue;
    if (start > cursor) parts.push(content.slice(cursor, start));
    parts.push(<a key={`${start}:${href}`} href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); void openExternalUrl(href!).catch(onLinkError); }}>{candidate}<ExternalLink size={10} aria-hidden="true" /></a>);
    if (end < raw.length) parts.push(raw.slice(end));
    cursor = start + raw.length;
  }
  if (cursor < content.length) parts.push(content.slice(cursor));
  return parts.length ? parts : content;
}

const Message = memo(function Message({ message, streaming = false, onLinkError }: { message: ChatMessage; streaming?: boolean; onLinkError: (error: unknown) => void }) {
  return <Localized><article className={`message message--${message.role}`}>
    <div className={`avatar avatar--${message.role}`}>{message.role === 'user' ? 'MP' : <img src={orderCodeMark} alt="" aria-hidden="true" draggable={false} />}</div>
    <div className="message-body"><div className="message-meta"><strong>{message.role === 'user' ? 'Tú' : 'OrderCode'}</strong><span>{message.timestamp}</span></div>{message.role === 'assistant' ? <ChatMarkdown content={message.content} streaming={streaming} onLinkError={onLinkError} /> : <p>{linkedMessageContent(message.content, onLinkError)}</p>}{message.refs?.length ? <div className="message-refs">{message.refs.map((ref) => <span key={ref} className="file-ref"><FileCode2 size={12} />{ref}</span>)}</div> : null}</div>
  </article></Localized>;
});

function ChangedFiles({ onOpenReview }: { onOpenReview: () => void }) {
  const files = [...new Set(useDesktopStore((state) => state.events).flatMap((event) => event.changedFiles ?? []))];
  if (!files.length) return null;
  return <Localized><section className="changed-files"><div className="section-heading"><strong>Cambios de esta ejecución</strong><span className="panel-title-spacer" /><span className="delta">{files.length} archivo{files.length === 1 ? '' : 's'}</span></div>{files.map((name) => <div className="changed-file" key={name}><span className="code-badge">{name.split('.').pop()?.toUpperCase() ?? 'FILE'}</span><span>{name}</span></div>)}<button className="review-link" type="button" onClick={onOpenReview}>Revisar cambios <Kbd>Ctrl ⇧ D</Kbd></button></section></Localized>;
}

const slashCommands = [
  { name: 'help', label: 'Ayuda', description: 'Ver los comandos disponibles', icon: CircleHelp },
  { name: 'agents', label: 'Agentes', description: 'Ver y elegir especialistas disponibles', icon: Bot },
  { name: 'context', label: 'Contexto', description: 'Ver uso de contexto y tokens', icon: Activity },
  { name: 'compact', label: 'Compactar contexto', description: 'Reducir historial futuro sin borrarlo', icon: Layers3 },
  { name: 'model', label: 'Modelo', description: 'Elegir o buscar un modelo', icon: Search },
  { name: 'effort', label: 'Esfuerzo', description: 'Cambiar el razonamiento del modelo', icon: CircleDashed },
  { name: 'mode', label: 'Modo', description: 'Cambiar entre Auto, Plan y Build', icon: Activity },
  { name: 'permissions', label: 'Permisos', description: 'Cambiar el nivel de permisos', icon: ShieldCheck },
  { name: 'review', label: 'Revisar cambios', description: 'Abrir la revisión del proyecto', icon: FileCode2 },
] as const;
type ComposerPanel = 'help' | 'agents' | 'context' | 'compact' | 'effort' | 'locked' | null;

function Composer({ onSubmit, onCancel, onConfigError, onOpenSettings, onOpenReview, onModelState }: { onSubmit: (content: string, continueUntilDone: boolean) => Promise<boolean>; onCancel: () => void; onConfigError: (error: string) => void; onOpenSettings: () => void; onOpenReview: () => void; onModelState: (state: { ready: boolean; label: string }) => void }) {
  const composerRef = useRef<HTMLFormElement>(null);
  const commandPopoverRef = useRef<HTMLDivElement>(null);
  const slashPopoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<'model' | 'effort' | 'options' | 'mode' | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [panel, setPanel] = useState<ComposerPanel>(null);
  const [continueUntilDone, setContinueUntilDone] = useState(false);
  const continuousRunSubmitted = useRef(false);
  const panelRequest = useRef(0);
  const settingsRequest = useRef(0);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[] | null>(null);
  const [agentProfilesBusy, setAgentProfilesBusy] = useState(false);
  const [agentProfilesError, setAgentProfilesError] = useState('');
  const [contextBusy, setContextBusy] = useState(false);
  const [contextData, setContextData] = useState<Awaited<ReturnType<typeof loadUsageAnalytics>> | null>(null);
  const [contextError, setContextError] = useState('');
  const [compactResult, setCompactResult] = useState<Awaited<ReturnType<typeof compactSessionContext>> | null>(null);
  const [compactError, setCompactError] = useState('');
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [catalogGeneration, setCatalogGeneration] = useState(0);
  const [discovery, setDiscovery] = useState('Buscando proveedores…');
  const catalogCache = useRef(new Map<string, ProviderModel[]>());
  const loadingCatalogs = useRef(new Set<string>());
  const failedCatalogs = useRef(new Set<string>());
  const catalogRevision = useRef(0);
  const { model, reasoningEffort, mode, permission, freeOnly, agentId, runtimeState, session, events, health: brokerHealth, hiddenModelProviders, recentModels, set } = useDesktopStore();
  const draftKey = session?.id ?? '__new__';
  const value = useComposerDraftStore((state) => state.drafts[draftKey] ?? '');
  const setValue = (next: string | ((current: string) => string)) => useComposerDraftStore.getState().setDraft(draftKey, next);
  const executionBusy = ['RUNNING', 'PREPARING', 'WAITING_APPROVAL', 'PAUSING'].includes(runtimeState);
  const activeContinuous = useMemo(() => {
    if (!executionBusy) return undefined;
    let runId: string | undefined;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      if (!runId && event.runId && /^(session\.state|run\.(started|completed|failed|cancelled))$/.test(event.type ?? event.summary)) {
        if (!['RUNNING', 'PREPARING', 'WAITING_APPROVAL', 'PAUSING'].includes(event.state)) return undefined;
        runId = event.runId;
      }
      if (runId && event.runId === runId && typeof event.continueUntilDone === 'boolean') return event.continueUntilDone;
    }
    return undefined;
  }, [events, executionBusy]);
  const continuousEnabled = activeContinuous ?? continueUntilDone;
  useEffect(() => {
    continuousRunSubmitted.current = false;
    settingsRequest.current += 1;
    setContinueUntilDone(false);
  }, [session?.id]);
  useEffect(() => {
    panelRequest.current += 1;
    setPanel(null); setOpen(null); setContextBusy(false); setContextData(null); setCompactResult(null); setContextError(''); setCompactError('');
  }, [session?.id, model]);
  useEffect(() => {
    if (!continuousRunSubmitted.current || !['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_USER', 'RECOVERY_REQUIRED'].includes(runtimeState)) return;
    continuousRunSubmitted.current = false;
    setContinueUntilDone(false);
  }, [runtimeState]);
  useEffect(() => {
    let current = true;
    let refreshRequest = 0;
    const refresh = async () => {
      const request = ++refreshRequest;
      setDiscovery('Buscando proveedores…');
      try {
        const found = await listProviders();
        if (!current || request !== refreshRequest) return;
        catalogRevision.current += 1;
        catalogCache.current.clear();
        loadingCatalogs.current.clear();
        failedCatalogs.current.clear();
        setCatalogError(false);
        setProviders(found);
        setCatalogGeneration(catalogRevision.current);
      } catch {
        if (current && request === refreshRequest) setDiscovery('La búsqueda de modelos requiere la app de escritorio.');
      }
    };
    const onProvidersUpdated = () => { void refresh(); };
    window.addEventListener('ordercode:providers-updated', onProvidersUpdated);
    void refresh();
    return () => { current = false; window.removeEventListener('ordercode:providers-updated', onProvidersUpdated); };
  }, [brokerHealth?.harnessConnected]);

  useEffect(() => {
    const revision = catalogRevision.current;
    const included = providers.filter((provider) => !hiddenModelProviders.includes(provider.id) || provider.id === model.split('::')[0]);
    const targets = included.filter((provider) => provider.configured || ['ollama', 'lmstudio', 'opencode_zen', 'openrouter'].includes(provider.id));
    const pending = targets.filter((provider) => !catalogCache.current.has(provider.id) && !loadingCatalogs.current.has(provider.id) && !failedCatalogs.current.has(provider.id));
    if (!pending.length) {
      if (targets.some((provider) => loadingCatalogs.current.has(provider.id))) { setCatalogBusy(true); return; }
      const found = included.flatMap((provider) => catalogCache.current.get(provider.id) ?? []);
      setModels(found);
      setCatalogBusy(false);
      setCatalogError(targets.some((provider) => failedCatalogs.current.has(provider.id)));
      setDiscovery(found.length ? '' : included.length ? 'No se encontraron modelos en los proveedores seleccionados.' : 'Activa un proveedor en Ajustes para descubrir modelos.');
      return;
    }
    setCatalogBusy(true);
    setDiscovery('Cargando modelos destacados…');
    for (const provider of pending) loadingCatalogs.current.add(provider.id);
    for (const provider of pending) {
      void listProviderModels(provider.id).then((found) => {
        if (catalogRevision.current !== revision) return;
        catalogCache.current.set(provider.id, found);
        failedCatalogs.current.delete(provider.id);
      }).catch(() => {
        if (catalogRevision.current === revision && !['ollama', 'lmstudio'].includes(provider.id)) failedCatalogs.current.add(provider.id);
      }).finally(() => {
        if (catalogRevision.current !== revision) return;
        loadingCatalogs.current.delete(provider.id);
        const found = included.flatMap((item) => catalogCache.current.get(item.id) ?? []);
        const failed = targets.some((item) => failedCatalogs.current.has(item.id));
        setModels(found);
        setCatalogBusy(targets.some((item) => loadingCatalogs.current.has(item.id)));
        setCatalogError(failed);
        setDiscovery(failed ? 'No se pudo cargar un catálogo. Revisa la conexión e inténtalo de nuevo.' : found.length ? '' : included.length ? 'No se encontraron modelos en los proveedores seleccionados.' : 'Activa un proveedor en Ajustes para descubrir modelos.');
      });
    }
  }, [providers, hiddenModelProviders, model, catalogRetry, catalogGeneration]);

  const selectedModel = models.find((item) => model === `${item.providerId}::${item.id}`);
  const modelSelectionMissing = !model || !selectedModel;
  const efforts = selectedModel?.reasoningEfforts ?? [];
  const slashQuery = value.startsWith('/') && !/\s/.test(value) ? value.slice(1).toLowerCase() : null;
  const matchingSlashCommands = slashQuery === null ? [] : slashCommands.filter((command) => command.name.startsWith(slashQuery));
  const showSlashMenu = matchingSlashCommands.length > 0;
  const modelNeedsCredentials = Boolean(selectedModel && !selectedModel.available);
  const freeOnlyBlocked = freeOnly && (!selectedModel || (selectedModel.priceKind !== 'free' && selectedModel.priceKind !== 'local'));
  useEffect(() => { onModelState({ ready: Boolean(selectedModel?.available) && !freeOnlyBlocked, label: selectedModel?.label ?? '' }); }, [selectedModel?.available, selectedModel?.label, freeOnlyBlocked, onModelState]);
  const retryCatalogs = () => { for (const provider of providers) if (failedCatalogs.current.has(provider.id) && !hiddenModelProviders.includes(provider.id)) failedCatalogs.current.delete(provider.id); setCatalogRetry((value) => value + 1); };
  useEffect(() => {
    const matches = slashCommands.filter((command) => slashQuery !== null && command.name.startsWith(slashQuery));
    const exactMatch = matches.findIndex((command) => command.name === slashQuery);
    setSlashIndex(exactMatch >= 0 ? exactMatch : 0);
  }, [slashQuery]);
  useEffect(() => {
    if (showSlashMenu) slashPopoverRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex, showSlashMenu]);
  const executeSlashCommand = async (commandName: string) => {
    const request = ++panelRequest.current;
    const revision = useDesktopStore.getState().sessionRevision;
    const isCurrent = () => panelRequest.current === request && useDesktopStore.getState().sessionRevision === revision;
    setValue(''); setOpen(null); setPanel(null); setContextError(''); setCompactError(''); setContextBusy(false);
    if (executionBusy && ['model', 'effort', 'mode', 'permissions'].includes(commandName)) { setPanel('locked'); return; }
    if (commandName === 'help') { setPanel('help'); return; }
    if (commandName === 'agents') {
      setPanel('agents'); setAgentProfilesError('');
      if (agentProfiles !== null || agentProfilesBusy) return;
      if (!isDesktopApp()) { setAgentProfiles([]); setAgentProfilesError('Los agentes personalizados requieren la aplicación de escritorio.'); return; }
      setAgentProfilesBusy(true);
      try { setAgentProfiles(await listCustomAgents()); }
      catch { setAgentProfilesError('No se pudieron cargar los agentes personalizados. Revisa la conexión del Harness.'); }
      finally { setAgentProfilesBusy(false); }
      return;
    }
    if (commandName === 'context') {
      setPanel('context'); setContextData(null); setContextBusy(true);
      if (!session) { setContextError('Abre un workspace y ejecuta una tarea para ver el contexto.'); setContextBusy(false); return; }
      try { const data = await loadUsageAnalytics({ projectPath: session.projectPath, days: 0, sessionId: session.id, ...(session.model ? { modelId: session.model } : {}) }); if (isCurrent()) setContextData(data); }
      catch (error) { if (isCurrent()) setContextError(error instanceof Error ? error.message : String(error)); }
      finally { if (isCurrent()) setContextBusy(false); }
      return;
    }
    if (commandName === 'compact') {
      setPanel('compact'); setCompactResult(null); setContextBusy(true);
      if (!session) { setCompactError('Abre un workspace antes de compactar el contexto.'); setContextBusy(false); return; }
      try { const result = await compactSessionContext(session.id); if (isCurrent()) setCompactResult(result); }
      catch (error) { if (isCurrent()) setCompactError(error instanceof Error ? error.message : String(error)); }
      finally { if (isCurrent()) setContextBusy(false); }
      return;
    }
    if (commandName === 'model') { setOpen('model'); return; }
    if (commandName === 'effort') { if (efforts.length) setOpen('effort'); else setPanel('effort'); return; }
    if (commandName === 'mode') { setOpen('mode'); return; }
    if (commandName === 'permissions') { setOpen('options'); return; }
    if (commandName === 'review') { onOpenReview(); return; }
  };
  const submit = async () => {
    if (showSlashMenu && matchingSlashCommands[slashIndex]) { await executeSlashCommand(matchingSlashCommands[slashIndex]!.name); return; }
    const trimmed = value.trim();
    if (!trimmed || ['RUNNING', 'PREPARING', 'WAITING_APPROVAL', 'PAUSING'].includes(useDesktopStore.getState().runtimeState)) return;
    if (modelSelectionMissing) { onConfigError(catalogBusy ? 'Espera a que termine la búsqueda de modelos y selecciona uno disponible.' : (model ? 'El modelo guardado ya no está disponible. Selecciona un modelo del catálogo actual antes de enviar.' : 'Conecta un modelo para empezar.')); return; }
    if (modelNeedsCredentials) { onConfigError(selectedModel?.availabilityReason ?? (selectedModel?.providerId === 'openai_chatgpt' ? 'Conecta tu cuenta ChatGPT en Ajustes antes de usar el modelo.' : 'Conecta la clave API de este proveedor en Ajustes antes de usar el modelo.')); return; }
    if (freeOnlyBlocked) { onConfigError('Free Only necesita un modelo con precio gratuito verificado o inferencia local. No se enviará la solicitud con el modelo actual.'); return; }
    setValue('');
    const draftSessionId = useDesktopStore.getState().session?.id;
    const submitted = await onSubmit(trimmed, continueUntilDone);
    if (useDesktopStore.getState().session?.id !== draftSessionId) return;
    if (!submitted) { setValue((current) => current || trimmed); return; }
    if (continueUntilDone) {
      const state = useDesktopStore.getState().runtimeState;
      if (['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_USER', 'RECOVERY_REQUIRED'].includes(state)) setContinueUntilDone(false);
      else continuousRunSubmitted.current = true;
    }
  };
  const changeSetting = async (patch: Partial<Pick<SessionRecord, 'mode' | 'permission' | 'model' | 'providerId' | 'freeOnly' | 'reasoningEffort'>>): Promise<void> => {
    const active = useDesktopStore.getState().session;
    if (!active) return;
    const request = ++settingsRequest.current;
    const revision = useDesktopStore.getState().sessionRevision;
    const updated = { ...active, ...patch };
    set('session', updated);
    try { await updateSession(updated); } catch (error) {
      if (settingsRequest.current !== request || useDesktopStore.getState().sessionRevision !== revision || useDesktopStore.getState().session?.id !== active.id) return;
      set('session', active); set('mode', active.mode); set('permission', active.permission); set('model', active.providerId ? `${active.providerId}::${active.model}` : active.model); set('freeOnly', active.freeOnly ?? false);
      onConfigError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (executionBusy || !selectedModel || !reasoningEffort || selectedModel.reasoningEfforts?.includes(reasoningEffort)) return;
    set('reasoningEffort', undefined);
    if (session) void changeSetting({ reasoningEffort: undefined });
  }, [selectedModel?.providerId, selectedModel?.id, reasoningEffort, session?.id, executionBusy]);

  const latestContextCall = contextData?.latestCall;
  const contextTokens = latestContextCall?.inputTokens ?? latestContextCall?.estimatedSentTokens;
  const contextTokenSource = typeof latestContextCall?.inputTokens === 'number' ? 'Informado por el proveedor' : 'Estimación de OrderCode';
  const contextWindow = selectedModel?.contextWindowTokens;
  const contextFill = contextTokens !== undefined && contextWindow ? Math.round(contextTokens / contextWindow * 100) : undefined;
  const automaticCompactions = events.filter((event) => event.type === 'context.compacted' && event.runId).length;
  const automaticTokensSaved = events.filter((event) => event.type === 'context.compacted' && event.runId).reduce((sum, event) => sum + (event.estimatedTokensSaved ?? 0), 0);

  return <Localized><form ref={composerRef} className="composer" data-busy={runtimeState === 'RUNNING' || runtimeState === 'PREPARING'} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <span className="composer-aura" aria-hidden="true" />
    {panel && <AnchoredPopover anchor={composerRef} menuRef={commandPopoverRef} matchAnchor onDismiss={() => setPanel(null)} className="composer-command-panel" role="region" label={panel === 'agents' ? 'Agentes disponibles' : panel === 'context' ? 'Uso del contexto' : panel === 'compact' ? 'Compactación del contexto' : 'Comandos de chat'}>
      <div className="composer-command-panel-heading"><strong>{panel === 'help' ? 'Comandos del chat' : panel === 'agents' ? 'Especialistas disponibles' : panel === 'context' ? 'Uso del contexto' : panel === 'compact' ? 'Compactar contexto' : panel === 'locked' ? 'Configuración de la tarea' : 'Esfuerzo de razonamiento'}</strong><button type="button" aria-label="Cerrar panel" onClick={() => setPanel(null)}><X size={13} /></button></div>
      {panel === 'locked' && <div className="context-inspector"><p>Termina o detén la tarea antes de cambiar modelo, esfuerzo, modo o permisos.</p></div>}
      {panel === 'help' && <div className="slash-help-list">{slashCommands.map((command) => { const Icon = command.icon; return <button type="button" key={command.name} onClick={() => void executeSlashCommand(command.name)}><Icon size={13} /><code>/{command.name}</code><span>{command.description}</span></button>; })}</div>}
      {panel === 'agents' && <div className="agent-picker-panel">
        <div className="agent-picker-list">{OFFICIAL_AGENTS.map((agent) => <button type="button" className={`agent-picker-option ${agentId === agent.id ? 'is-active' : ''}`} key={agent.id} aria-pressed={agentId === agent.id} onClick={() => set('agentId', agent.id)}><span className="agent-picker-mark"><Bot size={13} /></span><span className="agent-picker-copy"><strong>{agent.name}</strong><small>{agent.detail}</small></span>{agentId === agent.id && <Check size={13} />}</button>)}
          {agentProfiles?.filter((profile) => profile.enabled).map((profile) => <button type="button" className={`agent-picker-option ${agentId === profile.id ? 'is-active' : ''}`} key={profile.id} aria-pressed={agentId === profile.id} onClick={() => set('agentId', profile.id)}><span className="agent-picker-mark agent-picker-mark--custom"><Bot size={13} /></span><span className="agent-picker-copy"><strong>{profile.name}</strong><small>{profile.description || 'Especialista personalizado'}</small></span>{agentId === profile.id && <Check size={13} />}</button>)}
        </div>
        <p>{agentProfilesBusy ? 'Cargando agentes personalizados…' : agentProfilesError || 'El especialista elegido se usa en el próximo mensaje. Los subagentes heredan modelo y permisos.'}</p>
      </div>}
      {panel === 'context' && <div className="context-inspector">
        {contextBusy ? <p>Consultando el uso de esta conversación…</p> : contextError ? <p className="context-inspector-error">{contextError}</p> : contextData?.latestCall && contextTokens !== undefined ? <>
          <div className="context-metric"><span>Última solicitud</span><strong>{contextTokens.toLocaleString()} tokens</strong></div>
          {contextWindow ? <><div className="context-meter" role="progressbar" aria-label="Contexto usado en la última solicitud" aria-valuemin={0} aria-valuemax={contextWindow} aria-valuenow={Math.min(contextTokens, contextWindow)}><span data-level={contextFill! >= 90 ? 'high' : contextFill! >= 70 ? 'medium' : 'low'} style={{ width: `${Math.min(100, contextFill!)}%` }} /></div><small>{contextFill}% de {contextWindow.toLocaleString()} tokens de contexto · {contextTokenSource}</small></> : <small>{contextTokenSource}. El proveedor no publicó el límite de contexto para este modelo.</small>}
          {contextData.estimatedSavedTokens > 0 && <small>OrderCode estima {contextData.estimatedSavedTokens.toLocaleString()} tokens ahorrados en esta conversación.</small>}
        </> : contextData?.latestCall ? <p>La última solicitud no incluye datos suficientes para estimar los tokens de entrada.</p> : !contextBusy && !contextError ? <p>Aún no hay solicitudes registradas para este modelo.</p> : null}
        {(automaticCompactions > 0 || automaticTokensSaved > 0) && <small>Compactación automática en esta sesión: {automaticCompactions} · {automaticTokensSaved.toLocaleString()} tokens estimados.</small>}
      </div>}
      {panel === 'compact' && <div className="context-inspector">
        {contextBusy ? <p>Preparando un resumen local del historial…</p> : compactError ? <p className="context-inspector-error">{compactError}</p> : compactResult?.compacted ? <><div className="context-metric"><span>Mensajes resumidos</span><strong>{compactResult.compactedMessages}</strong></div><p>Las próximas solicitudes usarán un extracto local y los 6 mensajes recientes. El historial completo sigue visible.</p><small>Ahorro estimado: {compactResult.estimatedTokensSaved.toLocaleString()} tokens en el contexto que se enviará al modelo. No se realizó ninguna llamada de IA.</small></> : compactResult?.reason === 'no-savings' ? <p>El historial ya es compacto; no se reduciría más sin quitar información útil.</p> : compactResult ? <p>No hay mensajes antiguos que compactar. Se conservaron {compactResult.retainedMessages} mensajes recientes.</p> : null}
      </div>}
      {panel === 'effort' && <div className="context-inspector"><p>Este modelo no publica niveles de razonamiento configurables. Se usará su nivel automático.</p><button type="button" className="context-action" onClick={() => { setPanel(null); setOpen('model'); }}>Elegir otro modelo</button></div>}
    </AnchoredPopover>}
    {showSlashMenu && <AnchoredPopover anchor={composerRef} menuRef={slashPopoverRef} matchAnchor className="slash-command-menu" label="Comandos disponibles">{matchingSlashCommands.map((command, index) => { const Icon = command.icon; return <button type="button" role="option" aria-selected={index === slashIndex} className={index === slashIndex ? 'is-active' : ''} key={command.name} onMouseDown={(event) => event.preventDefault()} onClick={() => void executeSlashCommand(command.name)}><Icon size={13} /><code>/{command.name}</code><span>{command.description}</span></button>; })}</AnchoredPopover>}
    <textarea value={value} onChange={(event) => { setValue(event.target.value); if (event.target.value.startsWith('/')) setPanel(null); }} onKeyDown={(event) => {
      if (showSlashMenu && event.key === 'ArrowDown') { event.preventDefault(); setSlashIndex((index) => (index + 1) % matchingSlashCommands.length); return; }
      if (showSlashMenu && event.key === 'ArrowUp') { event.preventDefault(); setSlashIndex((index) => (index - 1 + matchingSlashCommands.length) % matchingSlashCommands.length); return; }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); return; }
      if (event.key === 'Escape' && panel) { setPanel(null); return; }
      if (event.key === 'Escape' && showSlashMenu) { event.preventDefault(); setValue(''); return; }
      if (event.key === 'Escape' && ['RUNNING', 'PREPARING', 'PAUSING'].includes(runtimeState)) onCancel();
    }} placeholder="Describe lo que quieres hacer…" aria-label="Mensaje para OrderCode" aria-autocomplete="list" aria-expanded={showSlashMenu} rows={2} />
    <div className="composer-controls">
      <div className="composer-toolbar" role="group" aria-label="Configuración de la conversación">
      <Dropdown disabled={executionBusy} icon={Bot} label="Modelo" value={selectedModel ? shortModelLabel(selectedModel) : (model ? model.split('::').at(-1) ?? model : 'Elegir modelo')} open={open === 'model'} onOpenChange={(value) => setOpen((current) => value ? 'model' : current === 'model' ? null : current)} className="composer-dropdown composer-dropdown--model" menuClassName="model-picker-menu" menuRole="region" menuAlign="start">
        <ModelPicker models={models} providers={providers} selected={model} freeOnly={freeOnly} busy={catalogBusy} error={catalogError} discovery={discovery} onRetry={retryCatalogs} onSettings={() => { setOpen(null); onOpenSettings(); }} onFreeOnlyChange={() => { const enabled = !freeOnly; set('freeOnly', enabled); void changeSetting({ freeOnly: enabled }); }} onSelect={(item) => {
          if (!item.available) { setOpen(null); onOpenSettings(); return; }
          const key = `${item.providerId}::${item.id}`;
          const effort = reasoningEffort && item.reasoningEfforts?.includes(reasoningEffort) ? reasoningEffort : undefined;
          set('model', key); set('reasoningEffort', effort); set('recentModels', [key, ...recentModels.filter((value) => value !== key)].slice(0, 5)); setOpen(null);
          if (session) void changeSetting({ model: item.id, providerId: item.providerId, reasoningEffort: effort });
        }} />
      </Dropdown>
      {efforts.length > 0 && <Dropdown disabled={executionBusy} icon={Gauge} label="Esfuerzo" value={reasoningEffort ? effortLabel(reasoningEffort) : 'Auto'} open={open === 'effort'} onOpenChange={(value) => setOpen((current) => value ? 'effort' : current === 'effort' ? null : current)} className="composer-dropdown composer-dropdown--effort">
        <div className="dropdown-search">Nivel de razonamiento</div><DropdownOption active={!reasoningEffort} description="Usar el nivel predeterminado del proveedor." onClick={() => { set('reasoningEffort', undefined); setOpen(null); void changeSetting({ reasoningEffort: undefined }); }}>Automático</DropdownOption>{efforts.map((effort) => <DropdownOption key={effort} active={reasoningEffort === effort} onClick={() => { set('reasoningEffort', effort); setOpen(null); void changeSetting({ reasoningEffort: effort }); }}>{effortLabel(effort)}</DropdownOption>)}
      </Dropdown>}
      <Dropdown disabled={executionBusy} icon={mode === 'Plan' ? ListChecks : mode === 'Build' ? Code2 : WandSparkles} label="Modo" value={mode} open={open === 'mode'} onOpenChange={(value) => setOpen((current) => value ? 'mode' : current === 'mode' ? null : current)} className="composer-dropdown composer-dropdown--mode"><div className="dropdown-search">Modo de trabajo</div>{modes.map((item) => <DropdownOption key={item.name} active={mode === item.name} description={item.description} onClick={() => { set('mode', item.name); setOpen(null); void changeSetting({ mode: item.name }); }}>{item.name}</DropdownOption>)}</Dropdown>
      <Dropdown disabled={executionBusy} icon={ShieldCheck} label="Permisos" value={permission} open={open === 'options'} onOpenChange={(value) => setOpen((current) => value ? 'options' : current === 'options' ? null : current)} className="composer-dropdown composer-dropdown--options">
        <div role="group" aria-label="Permisos"><div className="dropdown-search"><ShieldCheck size={13} />Permisos</div>{permissions.map((item) => <DropdownOption key={item.name} active={permission === item.name} description={item.description} onClick={() => { set('permission', item.name); setOpen(null); void changeSetting({ permission: item.name }); }}>{item.name}</DropdownOption>)}</div>
      </Dropdown>
      <button type="button" className={`continuous-toggle ${continuousEnabled ? 'is-active' : ''}`} aria-label={continuousEnabled ? 'Desactivar modo continuo' : 'Activar modo continuo'} aria-pressed={continuousEnabled} title={executionBusy && continuousEnabled ? 'Modo continuo activo · trabajando en los objetivos según los límites de sesión.' : continuousEnabled ? 'La siguiente tarea seguirá hasta completarse según los límites de sesión y el modo se apagará al terminar' : 'Modo continuo: seguir trabajando hasta completar y verificar la tarea'} disabled={executionBusy} onClick={() => setContinueUntilDone((enabled) => !enabled)}><InfinityIcon size={15} aria-hidden="true" /><span>Continuo</span><span className="continuous-switch" aria-hidden="true"><span /></span></button>
      </div>
      <span className="control-spacer" />
      {runtimeState === 'RUNNING' || runtimeState === 'PREPARING' || runtimeState === 'PAUSING' ? <button className="send-button send-button--stop" type="button" aria-label="Detener ejecución" onClick={onCancel}><Square size={12} fill="currentColor" /></button> : <button className="send-button" type="submit" aria-label="Enviar mensaje" disabled={!value.trim() || (!showSlashMenu && (executionBusy || modelSelectionMissing || modelNeedsCredentials || freeOnlyBlocked))}><Send size={15} /></button>}
    </div>
    {(modelSelectionMissing || modelNeedsCredentials || freeOnlyBlocked || runtimeState === 'RUNNING' || continuousEnabled) && <div className="composer-hint"><span>{modelSelectionMissing ? catalogBusy ? 'Cargando modelos disponibles…' : 'Conecta un modelo para empezar.' : modelNeedsCredentials ? selectedModel?.availabilityReason ?? (selectedModel?.providerId === 'openai_chatgpt' ? 'Conecta tu cuenta ChatGPT en Ajustes para usar estos modelos.' : 'Conecta la clave API del proveedor en Ajustes para usar este catálogo.') : freeOnlyBlocked ? 'Selecciona un modelo gratuito verificado o local para continuar.' : executionBusy ? continuousEnabled ? 'Modo continuo activo · trabajando en los objetivos según los límites de sesión.' : 'Trabajando en tu proyecto…' : 'Modo continuo activo para el próximo mensaje · se apaga al terminar la tarea.'}</span><span>{runtimeState === 'RUNNING' ? 'Esc para detener' : ''}</span></div>}
  </form></Localized>;
}

export function ChatPanel({ previewOpen, onTogglePreview, onOpenReview, onOpenSettings }: { previewOpen: boolean; onTogglePreview: () => void; onOpenReview: () => void; onOpenSettings: () => void }) {
  const { messages, streamingText, mode, permission, model, reasoningEffort, freeOnly, session, agentId, runtimeState, addMessage, addEvent, set } = useDesktopStore();
  const [error, setError] = useState<string | null>(null);
  const onLinkError = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [modelState, setModelState] = useState({ ready: false, label: '' });
  useEffect(() => { setError(null); }, [session?.id]);
  const handleSubmit = async (content: string, continueUntilDone: boolean): Promise<boolean> => {
    const initial = useDesktopStore.getState();
    if (['RUNNING', 'PREPARING', 'WAITING_APPROVAL'].includes(initial.runtimeState)) return false;
    let submitted = false;
    setError(null);
    set('runtimeState', 'PREPARING');
    let activeSession = initial.session;
    let revision = initial.sessionRevision;
    const isCurrent = () => useDesktopStore.getState().sessionRevision === revision && useDesktopStore.getState().session?.id === activeSession?.id;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    try {
      if (!activeSession) {
        if (!model) throw new Error('Selecciona un modelo descubierto y conecta un workspace antes de ejecutar.');
        const workspace = await pickWorkspaceFolder();
        if (!isCurrent()) return false;
        if (!workspace) { set('runtimeState', initial.runtimeState); return false; }
        const created = await createSession({ projectPath: workspace, model, reasoningEffort, mode, permission, freeOnly });
        if (!isCurrent()) return false;
        activeSession = created;
        set('session', activeSession);
        revision = useDesktopStore.getState().sessionRevision;
        set('sessions', [activeSession, ...useDesktopStore.getState().sessions.filter((item) => item.id !== activeSession?.id)]);
      }
      addMessage({ id: crypto.randomUUID(), role: 'user', content, timestamp });
      submitted = true;
      set('streamingText', '');
      await followSessionOperation(activeSession.id, () => sendSessionMessage(activeSession!.id, content, mode, model, permission, activeSession!.providerId, agentId, freeOnly, reasoningEffort, continueUntilDone));
      return true;
    } catch (cause) {
      if (!isCurrent()) return submitted;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      set('streamingText', '');
      set('runtimeState', 'FAILED');
      if (activeSession) addEvent({ id: crypto.randomUUID(), sessionId: activeSession.id, sequence: 0, state: 'FAILED', summary: 'Ejecución fallida', detail: message });
      return submitted;
    }
  };
  const openWorkspace = async () => {
    if (openingWorkspace || ['RUNNING', 'PREPARING', 'WAITING_APPROVAL'].includes(useDesktopStore.getState().runtimeState)) return;
    setError(null);
    setOpeningWorkspace(true);
    try {
      const active = useDesktopStore.getState();
      if (active.editorContent !== active.editorOriginal) throw new Error('Guarda o descarta los cambios del editor antes de cambiar de workspace.');
      const projectPath = await pickWorkspaceFolder(session?.projectPath);
      if (!projectPath) return;
      const next = await createSession({ projectPath, model, reasoningEffort, mode, permission, freeOnly });
      set('session', next); set('model', next.providerId && next.model ? `${next.providerId}::${next.model}` : next.model); set('freeOnly', next.freeOnly ?? false);
      set('sessions', [next, ...useDesktopStore.getState().sessions.filter((item) => item.id !== next.id)]);
      set('messages', []); set('events', []); set('streamingText', ''); set('pendingPermission', null); set('openFile', null); set('editorContent', ''); set('editorOriginal', '');
      set('runtimeState', next.state); set('sidebarOpen', false); set('health', await health());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setOpeningWorkspace(false); }
  };
  const empty = !messages.length && !streamingText;
  const visibleMessages = messages.filter((message) => message.content.trim() || message.refs?.length);
  const responseStart = visibleMessages.reduce((index, message, current) => message.role === 'user' ? current + 1 : index, 0);
  const stateLabel = stateLabels[runtimeState];
  const projectName = session?.projectPath.split(/[\\/]/).filter(Boolean).at(-1);
  const busy = ['RUNNING', 'PREPARING', 'WAITING_APPROVAL', 'PAUSING'].includes(runtimeState);
  return <Localized><main className={'chat-panel ' + (empty ? 'is-empty' : '')}>
    <div className="conversation-header"><div><h1>{projectName ?? 'Nueva conversación'}</h1>{(!empty || busy || error) && <p><StatusDot color={error || runtimeState === 'FAILED' ? 'red' : busy ? 'green' : 'muted'} />{error ? 'Error' : stateLabel}</p>}</div><button type="button" className={`conversation-preview-toggle${previewOpen ? ' is-active' : ''}`} aria-label={previewOpen ? 'Cerrar vista previa' : 'Abrir vista previa'} aria-pressed={previewOpen} aria-controls="preview-context-panel" title={previewOpen ? 'Cerrar vista previa' : 'Ver web y gráficas del proyecto'} onClick={onTogglePreview}><ChartNoAxesCombined size={16} /></button></div>
    <div className="conversation-stage"><div className="conversation-scroll">
      {visibleMessages.length ? visibleMessages.slice(0, responseStart).map((message) => <Message message={message} key={message.id} onLinkError={onLinkError} />) : <div className="conversation-empty"><strong>¿Qué quieres crear?</strong><p>{session && modelState.ready ? 'Describe el cambio y OrderCode se encarga del siguiente paso.' : 'Abre un proyecto y cuéntanos tu idea.'}</p>
        {(!session || !modelState.ready) && <ol className="start-steps" aria-label="Primeros pasos">
          <li className={session ? 'is-complete' : ''}><span className="start-step-number">{session ? <Check size={16} /> : '1'}</span><div><strong>Tu proyecto</strong><p>{projectName ?? 'Elige una carpeta para guardar tu trabajo.'}</p></div><button type="button" disabled={openingWorkspace || busy} onClick={() => void openWorkspace()}>{openingWorkspace ? 'Abriendo…' : session ? 'Cambiar carpeta' : 'Abrir carpeta'}</button></li>
          <li className={modelState.ready ? 'is-complete' : ''}><span className="start-step-number">{modelState.ready ? <Check size={16} /> : '2'}</span><div><strong>Tu asistente</strong><p>{modelState.ready ? modelState.label : 'Conecta tu cuenta o utiliza un modelo local.'}</p></div>{modelState.ready ? <span className="start-step-ready">Listo</span> : <button type="button" onClick={onOpenSettings}>Conectar modelo</button>}</li>
        </ol>}
      </div>}
      <TaskActivity />{visibleMessages.slice(responseStart).map((message) => <Message message={message} key={message.id} onLinkError={onLinkError} />)}
      {streamingText && <Message message={{ id: 'assistant-stream', role: 'assistant', content: streamingText, timestamp: 'Ahora' }} streaming onLinkError={onLinkError} />}<ChangedFiles onOpenReview={onOpenReview} />{error && <div className="inline-error" role="alert"><X size={14} /><span>{error}</span></div>}
    </div><Composer onSubmit={handleSubmit} onCancel={() => { if (session) { const revision = useDesktopStore.getState().sessionRevision; void cancelSession(session.id).then(() => { if (useDesktopStore.getState().sessionRevision === revision) set('runtimeState', 'CANCELLED'); }).catch((cause) => setError(String(cause))); } }} onConfigError={setError} onOpenSettings={onOpenSettings} onOpenReview={onOpenReview} onModelState={setModelState} /></div>
  </main></Localized>;
}
