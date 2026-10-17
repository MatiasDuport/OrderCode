import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, CircleDashed, FileCode2, MoreHorizontal, Search, Send, ShieldCheck, Square, FolderOpen, Settings, X } from 'lucide-react';
import { cancelSession, createSession, health, loadSession, loadSessionEvents, listProviders, listProviderModels, pickWorkspaceFolder, sendSessionMessage, updateSession } from '../lib/ipc';
import { useDesktopStore, type ChatMessage } from '../lib/store';
import type { PermissionProfile, SessionRecord, WorkMode } from '../lib/contracts';
import type { ProviderModel } from '../lib/ipc';
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

function Composer({ onSubmit, onCancel, onConfigError, onOpenSettings }: { onSubmit: (content: string) => Promise<void>; onCancel: () => void; onConfigError: (error: string) => void; onOpenSettings: () => void }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState<'model' | 'mode' | 'permission' | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [discovery, setDiscovery] = useState('Buscando proveedores…');
  const { model, mode, permission, freeOnly, runtimeState, session, set } = useDesktopStore();
  useEffect(() => {
    let current = true;
    let refreshId = 0;
    const refresh = async () => {
      const id = ++refreshId;
      try {
        const providers = await listProviders();
        const enabled = providers.filter((provider) => provider.configured || provider.id === 'ollama' || provider.id === 'lmstudio' || provider.id === 'openrouter' || provider.id === 'opencode_zen');
        const results = await Promise.allSettled(enabled.map((provider) => listProviderModels(provider.id)));
        if (!current || id !== refreshId) return;
        const found = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
        setModels(found.sort((left, right) => Number(right.priceKind === 'free' || right.priceKind === 'local') - Number(left.priceKind === 'free' || left.priceKind === 'local') || left.label.localeCompare(right.label)));
        setDiscovery(found.length ? '' : enabled.length ? 'No se encontraron modelos en los proveedores configurados.' : 'Configura un proveedor en Ajustes para descubrir modelos.');
      } catch {
        if (current && id === refreshId) setDiscovery('La búsqueda de modelos requiere la app de escritorio.');
      }
    };
    const onProvidersUpdated = () => { void refresh(); };
    window.addEventListener('ordercode:providers-updated', onProvidersUpdated);
    void refresh();
    return () => { current = false; window.removeEventListener('ordercode:providers-updated', onProvidersUpdated); };
  }, []);

  const selectedModel = models.find((item) => model === `${item.providerId}::${item.id}`);
  const modelNeedsCredentials = Boolean(selectedModel && !selectedModel.available);
  const freeOnlyBlocked = freeOnly && (!selectedModel || (selectedModel.priceKind !== 'free' && selectedModel.priceKind !== 'local'));
  const filteredModels = useMemo(() => models.filter((item) => (!freeOnly || item.priceKind === 'free' || item.priceKind === 'local') && `${item.label} ${item.providerId}`.toLowerCase().includes(modelQuery.trim().toLowerCase())), [models, modelQuery, freeOnly]);
  const submit = async () => { const trimmed = value.trim(); if (!trimmed || runtimeState === 'RUNNING' || runtimeState === 'PREPARING') return; if (modelNeedsCredentials) { onConfigError(selectedModel?.providerId === 'openai_chatgpt' ? 'Conecta tu cuenta ChatGPT en Ajustes antes de usar el modelo.' : 'Conecta la clave API de este proveedor en Ajustes antes de usar el modelo.'); return; } if (freeOnlyBlocked) { onConfigError('Free Only necesita un modelo con precio gratuito verificado o inferencia local. No se enviará la solicitud con el modelo actual.'); return; } setValue(''); await onSubmit(trimmed); };
  const changeSetting = async (patch: Partial<Pick<SessionRecord, 'mode' | 'permission' | 'model' | 'providerId' | 'freeOnly'>>): Promise<void> => {
    const active = useDesktopStore.getState().session;
    if (!active) return;
    const updated = { ...active, ...patch };
    set('session', updated);
    try { await updateSession(updated); } catch (error) {
      set('session', active); set('mode', active.mode); set('permission', active.permission); set('model', active.providerId ? `${active.providerId}::${active.model}` : active.model); set('freeOnly', active.freeOnly ?? false);
      onConfigError(error instanceof Error ? error.message : String(error));
    }
  };

  return <Localized><form className="composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } if (event.key === 'Escape' && runtimeState === 'RUNNING') onCancel(); }} placeholder="Mensaje para OrderCode" aria-label="Mensaje para OrderCode" rows={2} />
    <div className="composer-controls">
      <Dropdown label="Modelo" value={selectedModel?.label ?? (model ? model.split('::').at(-1) ?? model : 'Selecciona modelo')} open={open === 'model'} onOpenChange={(value) => setOpen((current) => value ? 'model' : current === 'model' ? null : current)} className="composer-dropdown composer-dropdown--model">
        <label className="dropdown-search"><Search size={13} /><input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Buscar modelos" aria-label="Buscar modelos" /></label>
        <button type="button" className={`free-only-toggle ${freeOnly ? 'is-active' : ''}`} aria-pressed={freeOnly} onClick={() => { const enabled = !freeOnly; set('freeOnly', enabled); void changeSetting({ freeOnly: enabled }); }}><span className="free-only-check">{freeOnly ? '✓' : ''}</span><span><strong>Free Only</strong><small>Solo precio verificado gratuito o local</small></span></button>
        {filteredModels.map((item) => { const price = item.priceKind === 'free' ? 'Gratis verificado' : item.priceKind === 'local' ? 'Inferencia local · sin tarifa API' : item.priceKind === 'subscription' ? 'Plan ChatGPT · sujeto a límites' : item.pricing ? `$${item.pricing.inputPerMillionUsd.toFixed(6)} / $${item.pricing.outputPerMillionUsd.toFixed(6)} por 1M tokens` : 'Precio no verificado'; const providerLabel = item.providerId === 'opencode_zen' ? 'OpenCode' : item.providerId === 'openrouter' ? 'OpenRouter' : item.providerId === 'openai_chatgpt' ? 'ChatGPT' : item.providerId; const needsConnection = item.providerId === 'openai_chatgpt' ? 'Conecta tu cuenta en Ajustes' : 'Conecta la clave API en Ajustes'; const description = item.available ? `${providerLabel} · ${price}` : `${providerLabel} · ${price} · ${needsConnection}`; return <DropdownOption key={`${item.providerId}::${item.id}`} active={model === `${item.providerId}::${item.id}`} description={description} onClick={() => { if (!item.available) { setOpen(null); onOpenSettings(); return; } const next = `${item.providerId}::${item.id}`; set('model', next); setOpen(null); if (session) void changeSetting({ model: item.id, providerId: item.providerId }); }}>{item.label}</DropdownOption>; })}
        {!filteredModels.length && <div className="dropdown-empty">{freeOnly ? 'No hay modelos locales o gratuitos con precio verificado. Los modelos con precio desconocido quedan bloqueados.' : discovery || 'No hay resultados.'}<button type="button" onClick={() => { setOpen(null); onOpenSettings(); }}>Abrir Ajustes</button></div>}
      </Dropdown>
      <Dropdown label="Modo" value={mode} open={open === 'mode'} onOpenChange={(value) => setOpen((current) => value ? 'mode' : current === 'mode' ? null : current)} className="composer-dropdown"><div className="dropdown-search"><ShieldCheck size={13} /> Modo de trabajo</div>{modes.map((item) => <DropdownOption key={item.name} active={mode === item.name} description={item.description} onClick={() => { set('mode', item.name); setOpen(null); void changeSetting({ mode: item.name }); }}>{item.name}</DropdownOption>)}</Dropdown>
      <Dropdown label="Permisos" value={permission} open={open === 'permission'} onOpenChange={(value) => setOpen((current) => value ? 'permission' : current === 'permission' ? null : current)} className="composer-dropdown composer-dropdown--permission"><div className="dropdown-search"><ShieldCheck size={13} /> Perfil de permisos</div>{permissions.map((item) => <DropdownOption key={item.name} active={permission === item.name} description={item.description} onClick={() => { set('permission', item.name); setOpen(null); void changeSetting({ permission: item.name }); }}>{item.name}</DropdownOption>)}</Dropdown>
      <span className="control-spacer" />
      {runtimeState === 'RUNNING' || runtimeState === 'PREPARING' ? <button className="send-button send-button--stop" type="button" aria-label="Detener ejecución" onClick={onCancel}><Square size={12} fill="currentColor" /></button> : <button className="send-button" type="submit" aria-label="Enviar mensaje" disabled={!value.trim() || modelNeedsCredentials || freeOnlyBlocked}><Send size={15} /></button>}
    </div>
    <div className="composer-hint"><span>{modelNeedsCredentials ? selectedModel?.providerId === 'openai_chatgpt' ? 'Conecta tu cuenta ChatGPT en Ajustes para usar estos modelos.' : 'Conecta la clave API del proveedor en Ajustes para usar este catálogo.' : freeOnlyBlocked ? 'Selecciona un modelo gratuito verificado o local para continuar.' : runtimeState === 'RUNNING' ? 'Ejecución real · actividad guardada en la sesión' : 'Enter enviar · Shift Enter nueva línea'}</span><span>{runtimeState === 'RUNNING' ? 'Esc detener' : session ? mode : 'Conecta un workspace antes de ejecutar'}</span></div>
  </form></Localized>;
}

export function ChatPanel({ onOpenReview, onOpenSettings }: { onOpenReview: () => void; onOpenSettings: () => void }) {
  const { messages, streamingText, mode, permission, model, freeOnly, session, agentId, runtimeState, addMessage, addEvent, set } = useDesktopStore();
  const [error, setError] = useState<string | null>(null);
  const handleSubmit = async (content: string) => {
    setError(null);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    addMessage({ id: crypto.randomUUID(), role: 'user', content, timestamp });
    try {
      let activeSession = session;
      if (!activeSession) {
        if (!model) throw new Error('Selecciona un modelo descubierto y conecta un workspace antes de ejecutar.');
        const workspace = await pickWorkspaceFolder();
        if (!workspace) throw new Error('Selecciona una carpeta desde el panel Workspace para iniciar la sesión.');
        activeSession = await createSession({ projectPath: workspace, model, mode, permission, freeOnly });
        set('sessions', [activeSession, ...useDesktopStore.getState().sessions.filter((item) => item.id !== activeSession?.id)]);
      }
      set('session', activeSession);
      set('runtimeState', 'PREPARING');
      set('streamingText', '');
      let lastSequence = useDesktopStore.getState().events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
      let polling = true;
      const pollEvents = async () => {
        if (!polling) return;
        try {
          const recent = await loadSessionEvents(activeSession.id, lastSequence);
          for (const item of recent) { addEvent(item); lastSequence = Math.max(lastSequence, item.sequence); }
        } catch { /* The final session reload will surface any persistent RPC error. */ }
      };
      const timer = window.setInterval(() => { void pollEvents(); }, 250);
      let event;
      try {
        event = await sendSessionMessage(activeSession.id, content, mode, model, permission, activeSession.providerId, agentId, freeOnly);
        await pollEvents();
      } finally { polling = false; window.clearInterval(timer); }
      addEvent(event);
      if (event.detail && event.state !== 'WAITING_APPROVAL') addMessage({ id: crypto.randomUUID(), role: 'assistant', content: event.detail, timestamp });
      if (event.state === 'WAITING_APPROVAL') set('pendingPermission', event.permissionRequest ?? null);
      const saved = await loadSession(activeSession.id);
      set('session', saved.session);
      set('messages', saved.messages.map((item) => ({ id: item.id, role: item.role, content: item.content, timestamp: new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })));
      set('events', saved.events);
      set('streamingText', '');
      set('runtimeState', saved.pendingPermissions.length ? 'WAITING_APPROVAL' : saved.session.state);
      set('pendingPermission', saved.pendingPermissions[0] ?? null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      set('runtimeState', 'FAILED');
      if (session) addEvent({ id: crypto.randomUUID(), sessionId: session.id, sequence: Date.now(), state: 'FAILED', summary: 'Ejecución fallida', detail: message });
      addMessage({ id: crypto.randomUUID(), role: 'assistant', content: `No pude completar la solicitud: ${message}`, timestamp });
    }
  };
  const openWorkspace = async () => {
    setError(null);
    try {
      const active = useDesktopStore.getState();
      if (active.editorContent !== active.editorOriginal) throw new Error('Guarda o descarta los cambios del editor antes de cambiar de workspace.');
      const projectPath = await pickWorkspaceFolder(session?.projectPath);
      if (!projectPath) return;
      const next = await createSession({ projectPath, model, mode, permission, freeOnly });
      set('session', next); set('model', next.providerId && next.model ? `${next.providerId}::${next.model}` : next.model); set('freeOnly', next.freeOnly ?? false);
      set('sessions', [next, ...useDesktopStore.getState().sessions.filter((item) => item.id !== next.id)]);
      set('messages', []); set('events', []); set('streamingText', ''); set('pendingPermission', null);
      set('runtimeState', next.state); set('sidebarOpen', true); set('health', await health());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const empty = !messages.length && !streamingText;
  const stateLabel = runtimeState === 'CREATED' ? 'Listo' : runtimeState.replaceAll('_', ' ').toLowerCase();
  return <Localized><main className={`chat-panel ${empty ? 'is-empty' : ''}`}><div className="conversation-header"><div><h1>{session ? session.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Sesión activa' : 'Nueva sesión'}</h1><p><StatusDot color={runtimeState === 'FAILED' ? 'red' : session ? 'green' : 'muted'} /> {mode} <span>·</span> {error ? 'Error' : stateLabel}</p></div><IconButton icon={MoreHorizontal} label="Más acciones" onClick={onOpenSettings} /></div><div className="conversation-stage"><div className="conversation-scroll">{messages.length ? messages.map((message) => <Message message={message} key={message.id} />) : <div className="conversation-empty"><strong>¿Qué quieres construir?</strong><p>Conecta un workspace, configura un proveedor y elige Plan, Build o Auto.</p></div>}{streamingText && <Message message={{ id: 'assistant-stream', role: 'assistant', content: streamingText, timestamp: 'Ahora' }} />}<ActivityGroup /><ChangedFiles onOpenReview={onOpenReview} />{error && <div className="inline-error"><X size={14} /><span>{error}</span></div>}</div><Composer onSubmit={handleSubmit} onCancel={() => { if (session) void cancelSession(session.id).then(() => set('runtimeState', 'CANCELLED')).catch((cause) => setError(String(cause))); }} onConfigError={setError} onOpenSettings={onOpenSettings} />{empty && <div className="workspace-start-actions"><button type="button" onClick={() => void openWorkspace()}><FolderOpen size={15} />Abrir workspace</button><button type="button" onClick={onOpenSettings}><Settings size={15} />Abrir Ajustes</button></div>}</div><div className="chat-footer">{session && <button type="button" onClick={onOpenReview}>Abrir revisión de cambios</button>}<span className="panel-title-spacer" /><span>{session ? 'Runtime local · sesión persistente' : 'Sin sesión activa'}</span></div></main></Localized>;
}
