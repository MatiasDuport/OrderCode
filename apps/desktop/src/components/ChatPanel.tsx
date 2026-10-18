import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CircleDashed, FileCode2, MoreHorizontal, Search, Send, ShieldCheck, Square, FolderOpen, Settings, Star, X } from 'lucide-react';
import { cancelSession, createSession, health, listProviders, listProviderModels, pickWorkspaceFolder, sendSessionMessage, updateSession } from '../lib/ipc';
import { followSessionOperation } from '../lib/sessionExecution';
import { useDesktopStore, type ChatMessage } from '../lib/store';
import type { PermissionProfile, SessionRecord, WorkMode } from '../lib/contracts';
import type { ProviderInfo, ProviderModel } from '../lib/ipc';
import { Dropdown, DropdownOption, IconButton, Kbd, StatusDot } from './ui';
import { Localized } from '../lib/localization';
import orderCodeMark from '../../../../brand/LogoSinFondo.png';

const modes: Array<{ name: WorkMode; description: string }> = [
  { name: 'Plan', description: 'Investigar y planificar en modo de solo lectura' },
  { name: 'Build', description: 'Implementar, ejecutar herramientas y verificar' },
  { name: 'Auto', description: 'Elegir el siguiente paso según el trabajo' },
];
const permissions: Array<{ name: PermissionProfile; description: string }> = [
  { name: 'Lectura', description: 'Solo consultar archivos' },
  { name: 'Guiado', description: 'Solicitar autorización para cambios y comandos' },
  { name: 'Auto', description: 'Permitir acciones seguras; pedir autorización para acciones sensibles' },
  { name: 'Avanzado', description: 'Permisos amplios dentro del workspace' },
];
const effortLabels: Record<string, string> = { none: 'Sin esfuerzo adicional', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo' };
const effortLabel = (value: string) => effortLabels[value] ?? value;

function modelProviderLabel(providerId: string): string {
  return providerId === 'opencode_zen' ? 'OpenCode' : providerId === 'openai_chatgpt' ? 'ChatGPT' : providerId === 'xai_plan' ? 'SuperGrok' : providerId === 'openrouter' ? 'OpenRouter' : providerId === 'ollama' ? 'Ollama' : providerId === 'lmstudio' ? 'LM Studio' : providerId;
}

function modelRank(item: ProviderModel, recentModels: string[], favoriteModels: string[]): number[] {
  const tier = item.availabilityReason ? 5 : item.priceKind === 'free' ? 0 : item.priceKind === 'subscription' ? 1 : item.priceKind === 'local' ? 2 : item.priceKind === 'paid' ? 3 : 4;
  const key = `${item.providerId}::${item.id}`;
  const favorite = favoriteModels.includes(key);
  const recent = recentModels.indexOf(key);
  const popular = /(?:gpt-4\.1|claude.*sonnet|gemini.*(?:flash|pro)|deepseek.*(?:v3|chat)|qwen.*coder|grok.*code|llama.*3\.3)/i.test(item.id) ? 0 : 1;
  return [tier, favorite ? 0 : 1, recent < 0 ? 1 : 0, recent < 0 ? 99 : recent, item.available ? 0 : 1, popular];
}

function compareModelRank(left: ProviderModel, right: ProviderModel, recentModels: string[], favoriteModels: string[]): number {
  const a = modelRank(left, recentModels, favoriteModels); const b = modelRank(right, recentModels, favoriteModels);
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return left.label.localeCompare(right.label);
}

function Message({ message }: { message: ChatMessage }) {
  return <Localized><article className={`message message--${message.role}`}>
    <div className={`avatar avatar--${message.role}`}>{message.role === 'user' ? 'MP' : <img src={orderCodeMark} alt="" aria-hidden="true" draggable={false} />}</div>
    <div className="message-body"><div className="message-meta"><strong>{message.role === 'user' ? 'Tú' : 'OrderCode'}</strong><span>{message.timestamp}</span></div><p>{message.content}</p>{message.refs?.length ? <div className="message-refs">{message.refs.map((ref) => <span key={ref} className="file-ref"><FileCode2 size={12} />{ref}</span>)}</div> : null}</div>
  </article></Localized>;
}

function ActivityGroup() {
  const events = useDesktopStore((state) => state.events);
  const useful = events.filter((event) => event.summary !== 'message.created' && event.summary !== 'session.created' && event.summary !== 'provider.chunk');
  if (!useful.length) return null;
  return <Localized><section className="activity-group" aria-label="Ejecución de tareas"><div className="activity-heading"><ChevronDown size={13} /><CircleDashed className="activity-ring" size={16} /><strong>Actividad de tareas</strong><span className="panel-title-spacer" /><span className="muted">{useful.at(-1)?.state ?? 'CREATED'}</span></div>
    <div className="activity-items">{useful.slice(-30).map((event) => <div className="activity-item" key={event.id}><div className={`activity-status activity-status--${event.state.toLowerCase()}`}>{event.state === 'COMPLETED' ? <Check size={11} /> : <span />}</div><div className="activity-copy"><strong>{event.summary}</strong><small>{event.detail ?? event.state}</small></div><span className="activity-result">{event.state.replaceAll('_', ' ')}</span></div>)}</div>
  </section></Localized>;
}

function ChangedFiles({ onOpenReview }: { onOpenReview: () => void }) {
  const files = [...new Set(useDesktopStore((state) => state.events).flatMap((event) => event.changedFiles ?? []))];
  if (!files.length) return null;
  return <Localized><section className="changed-files"><div className="section-heading"><strong>Cambios de esta ejecución</strong><span className="panel-title-spacer" /><span className="delta">{files.length} archivo{files.length === 1 ? '' : 's'}</span></div>{files.map((name) => <div className="changed-file" key={name}><span className="code-badge">{name.split('.').pop()?.toUpperCase() ?? 'FILE'}</span><span>{name}</span></div>)}<button className="review-link" type="button" onClick={onOpenReview}>Revisar cambios <Kbd>Ctrl ⇧ D</Kbd></button></section></Localized>;
}

function Composer({ onSubmit, onCancel, onConfigError, onOpenSettings }: { onSubmit: (content: string) => Promise<boolean>; onCancel: () => void; onConfigError: (error: string) => void; onOpenSettings: () => void }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState<'model' | 'effort' | 'mode' | 'permission' | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [showAllNow, setShowAllNow] = useState<boolean | null>(null);
  const [discovery, setDiscovery] = useState('Buscando proveedores…');
  const catalogCache = useRef(new Map<string, ProviderModel[]>());
  const loadingCatalogs = useRef(new Set<string>());
  const failedCatalogs = useRef(new Set<string>());
  const catalogRevision = useRef(0);
  const { model, reasoningEffort, mode, permission, freeOnly, runtimeState, session, health: brokerHealth, hiddenModelProviders, showAdvancedModels, recentModels, favoriteModels, set } = useDesktopStore();
  useEffect(() => {
    let current = true;
    const refresh = async () => {
      setDiscovery('Buscando proveedores…');
      try {
        const found = await listProviders();
        if (!current) return;
        catalogRevision.current += 1;
        catalogCache.current.clear();
        loadingCatalogs.current.clear();
        failedCatalogs.current.clear();
        setCatalogError(false);
        setProviders(found);
      } catch {
        if (current) setDiscovery('La búsqueda de modelos requiere la app de escritorio.');
      }
    };
    const onProvidersUpdated = () => { void refresh(); };
    window.addEventListener('ordercode:providers-updated', onProvidersUpdated);
    void refresh();
    return () => { current = false; window.removeEventListener('ordercode:providers-updated', onProvidersUpdated); };
  }, [brokerHealth?.harnessConnected]);

  const advancedCatalog = Boolean(modelQuery.trim()) || (showAllNow ?? showAdvancedModels);
  useEffect(() => { setShowAllNow(null); }, [showAdvancedModels]);
  useEffect(() => {
    const revision = catalogRevision.current;
    const included = providers.filter((provider) => !hiddenModelProviders.includes(provider.id));
    const eager = included.filter((provider) => provider.id !== 'openrouter' && (provider.configured || ['ollama', 'lmstudio', 'opencode_zen'].includes(provider.id)));
    const targets = advancedCatalog ? included.filter((provider) => provider.configured || ['ollama', 'lmstudio', 'opencode_zen', 'openrouter'].includes(provider.id)) : eager;
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
        if (catalogRevision.current === revision) failedCatalogs.current.add(provider.id);
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
  }, [providers, hiddenModelProviders, advancedCatalog, catalogRetry, catalogRevision.current]);

  const selectedModel = models.find((item) => model === `${item.providerId}::${item.id}`);
  const efforts = selectedModel?.reasoningEfforts ?? [];
  const modelNeedsCredentials = Boolean(selectedModel && !selectedModel.available);
  const freeOnlyBlocked = freeOnly && (!selectedModel || (selectedModel.priceKind !== 'free' && selectedModel.priceKind !== 'local'));
  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    const matching = models.filter((item) => !hiddenModelProviders.includes(item.providerId) && (!freeOnly || item.priceKind === 'free' || item.priceKind === 'local') && `${item.label} ${item.providerId}`.toLowerCase().includes(query)).sort((left, right) => compareModelRank(left, right, recentModels, favoriteModels));
    if (advancedCatalog) return matching;
    const pinned = matching.filter((item) => favoriteModels.includes(`${item.providerId}::${item.id}`) || recentModels.includes(`${item.providerId}::${item.id}`));
    const pinnedKeys = new Set(pinned.map((item) => `${item.providerId}::${item.id}`));
    const perProvider = new Map<string, number>();
    const recommended = matching.filter((item) => {
      if (pinnedKeys.has(`${item.providerId}::${item.id}`)) return false;
      const count = perProvider.get(item.providerId) ?? 0;
      const cap = item.providerId === 'opencode_zen' ? 6 : item.providerId === 'openai_chatgpt' ? 5 : 3;
      if (count >= cap) return false;
      perProvider.set(item.providerId, count + 1);
      return true;
    }).slice(0, 20);
    return [...pinned, ...recommended].sort((left, right) => compareModelRank(left, right, recentModels, favoriteModels));
  }, [models, modelQuery, freeOnly, hiddenModelProviders, advancedCatalog, recentModels, favoriteModels]);
  const modelGroups = useMemo(() => {
    const groups = new Map<string, ProviderModel[]>();
    for (const item of filteredModels) groups.set(item.providerId, [...(groups.get(item.providerId) ?? []), item]);
    return [...groups.entries()].sort((left, right) => compareModelRank(left[1][0], right[1][0], recentModels, favoriteModels));
  }, [filteredModels, recentModels, favoriteModels]);
  const hasMoreModels = models.some((item) => !hiddenModelProviders.includes(item.providerId) && (!freeOnly || item.priceKind === 'free' || item.priceKind === 'local')) && models.filter((item) => !hiddenModelProviders.includes(item.providerId) && (!freeOnly || item.priceKind === 'free' || item.priceKind === 'local')).length > filteredModels.length;
  const hasDeferredCatalog = providers.some((provider) => provider.id === 'openrouter' && !hiddenModelProviders.includes(provider.id) && !catalogCache.current.has(provider.id));
  const retryCatalogs = () => { for (const provider of providers) if (failedCatalogs.current.has(provider.id) && !hiddenModelProviders.includes(provider.id)) failedCatalogs.current.delete(provider.id); setCatalogRetry((value) => value + 1); };
  const submit = async () => { const trimmed = value.trim(); if (!trimmed || ['RUNNING', 'PREPARING', 'WAITING_APPROVAL'].includes(useDesktopStore.getState().runtimeState)) return; if (modelNeedsCredentials) { onConfigError(selectedModel?.availabilityReason ?? (selectedModel?.providerId === 'openai_chatgpt' ? 'Conecta tu cuenta ChatGPT en Ajustes antes de usar el modelo.' : 'Conecta la clave API de este proveedor en Ajustes antes de usar el modelo.')); return; } if (freeOnlyBlocked) { onConfigError('Free Only necesita un modelo con precio gratuito verificado o inferencia local. No se enviará la solicitud con el modelo actual.'); return; } setValue(''); if (!await onSubmit(trimmed)) setValue((current) => current || trimmed); };
  const changeSetting = async (patch: Partial<Pick<SessionRecord, 'mode' | 'permission' | 'model' | 'providerId' | 'freeOnly' | 'reasoningEffort'>>): Promise<void> => {
    const active = useDesktopStore.getState().session;
    if (!active) return;
    const updated = { ...active, ...patch };
    set('session', updated);
    try { await updateSession(updated); } catch (error) {
      set('session', active); set('mode', active.mode); set('permission', active.permission); set('model', active.providerId ? `${active.providerId}::${active.model}` : active.model); set('freeOnly', active.freeOnly ?? false);
      onConfigError(error instanceof Error ? error.message : String(error));
    }
  };

  const renderModelOption = (item: ProviderModel) => {
    const key = `${item.providerId}::${item.id}`;
    const favorite = favoriteModels.includes(key);
    const price = item.priceKind === 'free' ? 'Gratis verificado' : item.priceKind === 'local' ? 'Inferencia local · sin tarifa API' : item.priceKind === 'subscription' ? 'Uso de tu plan · sujeto a límites' : item.pricing ? `$${item.pricing.inputPerMillionUsd.toFixed(6)} / $${item.pricing.outputPerMillionUsd.toFixed(6)} por 1M tokens` : 'Precio no verificado';
    const needsConnection = item.availabilityReason ?? (item.providerId === 'openai_chatgpt' ? 'Conecta tu cuenta en Ajustes' : item.providerId === 'xai_plan' ? 'Conecta tu cuenta SuperGrok en Ajustes' : 'Conecta la clave API en Ajustes');
    const description = item.availabilityReason ?? `${price}${item.available ? '' : ` · ${needsConnection}`}`;
    return <div className="model-option-row" key={key}>
      <DropdownOption active={model === key} disabled={Boolean(item.availabilityReason)} description={description} onClick={() => { if (!item.available) { setOpen(null); onOpenSettings(); return; } const effort = reasoningEffort && item.reasoningEfforts?.includes(reasoningEffort) ? reasoningEffort : undefined; set('model', key); set('reasoningEffort', effort); set('recentModels', [key, ...recentModels.filter((value) => value !== key)].slice(0, 5)); setOpen(null); if (session) void changeSetting({ model: item.id, providerId: item.providerId, reasoningEffort: effort }); }}>{item.label}</DropdownOption>
      <button type="button" className={`model-favorite-button ${favorite ? 'is-active' : ''}`} aria-label={`${favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}: ${item.label}`} aria-pressed={favorite} title={favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'} onClick={(event) => { event.stopPropagation(); set('favoriteModels', favorite ? favoriteModels.filter((value) => value !== key) : [...favoriteModels, key].slice(-100)); }}><Star size={13} /></button>
    </div>;
  };

  return <Localized><form className="composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } if (event.key === 'Escape' && runtimeState === 'RUNNING') onCancel(); }} placeholder="Mensaje para OrderCode" aria-label="Mensaje para OrderCode" rows={2} />
    <div className="composer-controls">
      <Dropdown label="Modelo" value={selectedModel?.label ?? (model ? model.split('::').at(-1) ?? model : 'Selecciona un modelo')} open={open === 'model'} onOpenChange={(value) => setOpen((current) => value ? 'model' : current === 'model' ? null : current)} className="composer-dropdown composer-dropdown--model">
        <label className="dropdown-search"><Search size={13} /><input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Buscar modelos" aria-label="Buscar modelos" /></label>
        <button type="button" className={`free-only-toggle ${freeOnly ? 'is-active' : ''}`} aria-pressed={freeOnly} onClick={() => { const enabled = !freeOnly; set('freeOnly', enabled); void changeSetting({ freeOnly: enabled }); }}><span className="free-only-check">{freeOnly ? '✓' : ''}</span><span><strong>Free Only</strong><small>Solo precio verificado gratuito o local</small></span></button>
        {modelGroups.map(([providerId, items]) => <section className="model-provider-group" key={providerId} role="group" aria-label={modelProviderLabel(providerId)}><div className="model-provider-heading" aria-hidden="true"><span>{modelProviderLabel(providerId)}</span><small>{items.some((item) => item.priceKind === 'free') ? 'GRATUITOS PRIMERO' : items[0]?.priceKind === 'subscription' ? 'PLAN INCLUIDO' : `${items.length} MODELO${items.length === 1 ? '' : 'S'}`}</small></div>{items.map(renderModelOption)}</section>)}
        {(catalogBusy || catalogError || (!advancedCatalog && (hasMoreModels || hasDeferredCatalog))) && <button type="button" className="model-catalog-toggle" disabled={catalogBusy} onClick={() => { if (catalogError) retryCatalogs(); else setShowAllNow(true); }}>{catalogBusy ? 'Cargando catálogo…' : catalogError ? 'Reintentar catálogo' : 'Ver más modelos'}<small>{catalogBusy ? 'Consultando proveedores seleccionados' : catalogError ? 'No se pudo completar la búsqueda' : 'Catálogo completo agrupado por proveedor'}</small></button>}
        {advancedCatalog && (hasMoreModels || showAllNow === true) && <button type="button" className="model-catalog-toggle" onClick={() => { setModelQuery(''); setShowAllNow(false); }}><span>Volver a recomendados</span><small>Lista breve con gratuitos, favoritos y recientes primero</small></button>}
        {!filteredModels.length && <div className="dropdown-empty">{freeOnly ? 'No hay modelos locales o gratuitos con precio verificado. Los modelos con precio desconocido quedan bloqueados.' : discovery || 'No hay resultados.'}<button type="button" onClick={() => { setOpen(null); onOpenSettings(); }}>Abrir Ajustes</button></div>}
      </Dropdown>
      <Dropdown label="Esfuerzo" value={`Esfuerzo: ${reasoningEffort ? effortLabel(reasoningEffort) : 'Auto'}`} open={open === 'effort'} onOpenChange={(value) => setOpen((current) => value ? 'effort' : current === 'effort' ? null : current)} className="composer-dropdown composer-dropdown--effort">
        <div className="dropdown-search">Esfuerzo del modelo</div>
        <DropdownOption active={!reasoningEffort} description={efforts.length ? 'Usar el nivel predeterminado del proveedor.' : 'Este modelo no expone niveles de esfuerzo configurables.'} onClick={() => { set('reasoningEffort', undefined); setOpen(null); void changeSetting({ reasoningEffort: undefined }); }}>Automático</DropdownOption>
        {efforts.map((effort) => <DropdownOption key={effort} active={reasoningEffort === effort} onClick={() => { set('reasoningEffort', effort); setOpen(null); void changeSetting({ reasoningEffort: effort }); }}>{effortLabel(effort)}</DropdownOption>)}
      </Dropdown>
      <Dropdown label="Modo" value={mode} open={open === 'mode'} onOpenChange={(value) => setOpen((current) => value ? 'mode' : current === 'mode' ? null : current)} className="composer-dropdown"><div className="dropdown-search"><ShieldCheck size={13} /> Modo de trabajo</div>{modes.map((item) => <DropdownOption key={item.name} active={mode === item.name} description={item.description} onClick={() => { set('mode', item.name); setOpen(null); void changeSetting({ mode: item.name }); }}>{item.name}</DropdownOption>)}</Dropdown>
      <Dropdown label="Permisos" value={permission} open={open === 'permission'} onOpenChange={(value) => setOpen((current) => value ? 'permission' : current === 'permission' ? null : current)} className="composer-dropdown composer-dropdown--permission"><div className="dropdown-search"><ShieldCheck size={13} /> Perfil de permisos</div>{permissions.map((item) => <DropdownOption key={item.name} active={permission === item.name} description={item.description} onClick={() => { set('permission', item.name); setOpen(null); void changeSetting({ permission: item.name }); }}>{item.name}</DropdownOption>)}</Dropdown>
      <span className="control-spacer" />
      {runtimeState === 'RUNNING' || runtimeState === 'PREPARING' ? <button className="send-button send-button--stop" type="button" aria-label="Detener ejecución" onClick={onCancel}><Square size={12} fill="currentColor" /></button> : <button className="send-button" type="submit" aria-label="Enviar mensaje" disabled={!value.trim() || runtimeState === 'WAITING_APPROVAL' || modelNeedsCredentials || freeOnlyBlocked}><Send size={15} /></button>}
    </div>
    <div className="composer-hint"><span>{modelNeedsCredentials ? selectedModel?.availabilityReason ?? (selectedModel?.providerId === 'openai_chatgpt' ? 'Conecta tu cuenta ChatGPT en Ajustes para usar estos modelos.' : 'Conecta la clave API del proveedor en Ajustes para usar este catálogo.') : freeOnlyBlocked ? 'Selecciona un modelo gratuito verificado o local para continuar.' : runtimeState === 'RUNNING' ? 'Ejecución real · actividad guardada en la sesión' : 'Enter para enviar · Shift+Enter para nueva línea'}</span><span>{runtimeState === 'RUNNING' ? 'Esc para detener' : session ? mode : 'Conecta un workspace antes de ejecutar'}</span></div>
  </form></Localized>;
}

export function ChatPanel({ onOpenReview, onOpenSettings }: { onOpenReview: () => void; onOpenSettings: () => void }) {
  const { messages, streamingText, mode, permission, model, reasoningEffort, freeOnly, session, agentId, runtimeState, addMessage, addEvent, set } = useDesktopStore();
  const [error, setError] = useState<string | null>(null);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const handleSubmit = async (content: string): Promise<boolean> => {
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
      await followSessionOperation(activeSession.id, () => sendSessionMessage(activeSession!.id, content, mode, model, permission, activeSession!.providerId, agentId, freeOnly, reasoningEffort));
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
      set('runtimeState', next.state); set('sidebarOpen', true); set('health', await health());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setOpeningWorkspace(false); }
  };
  const empty = !messages.length && !streamingText;
  const stateLabel = runtimeState === 'CREATED' ? 'Listo' : runtimeState.replaceAll('_', ' ').toLowerCase();
  return <Localized><main className={`chat-panel ${empty ? 'is-empty' : ''}`}><div className="conversation-header"><div><h1>{session ? session.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Sesión activa' : 'Nueva sesión'}</h1><p><StatusDot color={runtimeState === 'FAILED' ? 'red' : session ? 'green' : 'muted'} /> {mode} <span>·</span> {error ? 'Error' : stateLabel}</p></div><IconButton icon={MoreHorizontal} label="Más acciones" onClick={onOpenSettings} /></div><div className="conversation-stage"><div className="conversation-scroll">{messages.length ? messages.map((message) => <Message message={message} key={message.id} />) : <div className="conversation-empty"><strong>¿Qué quieres construir?</strong><p>Conecta un workspace, configura un proveedor y elige Plan, Build o Auto.</p></div>}{streamingText && <Message message={{ id: 'assistant-stream', role: 'assistant', content: streamingText, timestamp: 'Ahora' }} />}<ActivityGroup /><ChangedFiles onOpenReview={onOpenReview} />{error && <div className="inline-error" role="alert"><X size={14} /><span>{error}</span></div>}</div><Composer onSubmit={handleSubmit} onCancel={() => { if (session) { const revision = useDesktopStore.getState().sessionRevision; void cancelSession(session.id).then(() => { if (useDesktopStore.getState().sessionRevision === revision) set('runtimeState', 'CANCELLED'); }).catch((cause) => setError(String(cause))); } }} onConfigError={setError} onOpenSettings={onOpenSettings} />{empty && <div className="workspace-start-actions"><button type="button" disabled={openingWorkspace} onClick={() => void openWorkspace()}><FolderOpen size={15} />Abrir workspace</button><button type="button" onClick={onOpenSettings}><Settings size={15} />Abrir Ajustes</button></div>}</div><div className="chat-footer">{session && <button type="button" onClick={onOpenReview}>Abrir revisión de cambios</button>}<span className="panel-title-spacer" /><span>{session ? 'Runtime local · sesión persistente' : 'Sin sesión activa'}</span></div></main></Localized>;
}
