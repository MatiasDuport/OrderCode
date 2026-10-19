import { Bot, Check, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { deleteCustomAgent, listAvailableAgentTools, listCustomAgents, saveCustomAgent, testCustomAgent } from '../lib/ipc';
import type { AgentProfile, AgentTestResult, AgentToolChoice } from '../lib/contracts';
import type { OfficialAgent } from '../lib/agents';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';

interface Draft { id?: string; name: string; description: string; instructions: string; toolAllowlist: string[]; enabled: boolean }

export function AgentStudio({ officialAgents }: { officialAgents: OfficialAgent[] }) {
  const { agentId, health, session, set } = useDesktopStore();
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [tools, setTools] = useState<AgentToolChoice[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testPrompt, setTestPrompt] = useState('Explica cómo investigarías una regresión pequeña y qué pruebas usarías para confirmar la causa.');
  const [testResult, setTestResult] = useState<AgentTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const [nextProfiles, nextTools] = await Promise.all([listCustomAgents(), listAvailableAgentTools(session?.id)]);
      setProfiles(nextProfiles);
      setTools(nextTools.filter((tool) => tool.name !== 'desktop.terminal.open'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  useEffect(() => { if (health?.harnessConnected) void refresh(); }, [health?.harnessConnected, session?.id]);

  const create = () => {
    const safeDefaults = tools.filter((tool) => tool.effects.every((effect) => effect === 'READ')).map((tool) => tool.name);
    setDraft({ name: '', description: '', instructions: '', toolAllowlist: safeDefaults, enabled: true });
    setNotice(''); setError('');
  };
  const edit = (profile: AgentProfile) => {
    setDraft({ id: profile.id, name: profile.name, description: profile.description, instructions: profile.instructions, toolAllowlist: [...profile.toolAllowlist], enabled: profile.enabled });
    setNotice(''); setError('');
  };
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const profile = await saveCustomAgent(draft);
      await refresh();
      if (profile.enabled) set('agentId', profile.id);
      else if (agentId === profile.id) set('agentId', 'general');
      setDraft(null);
      setNotice(`“${profile.name}” quedó guardado y seleccionado. Hereda el modelo y los permisos de la conversación.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const remove = async (profile: AgentProfile) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await deleteCustomAgent(profile.id);
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      if (agentId === profile.id) set('agentId', 'general');
      if (draft?.id === profile.id) setDraft(null);
      setNotice(`“${profile.name}” se eliminó.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (!draft || !session || !draft.enabled || testing) return;
    setTesting(true); setError(''); setTestResult(null);
    try {
      const profile = await saveCustomAgent(draft);
      setProfiles((current) => [profile, ...current.filter((item) => item.id !== profile.id)]);
      setDraft({ ...draft, id: profile.id });
      set('agentId', profile.id);
      const result = await testCustomAgent(session.id, profile.id, testPrompt);
      setTestResult(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setTesting(false); }
  };
  const exportProfiles = () => {
    const data = JSON.stringify({ version: 1, profiles: profiles.map(({ name, description, instructions, toolAllowlist, enabled }) => ({ name, description, instructions, toolAllowlist, enabled })) }, null, 2);
    const href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = href; anchor.download = 'ordercode-agents.json'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const importProfiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTransferring(true); setError(''); setNotice('');
    try {
      if (file.size > 1_000_000) throw new Error('El archivo de agentes supera 1 MB.');
      const raw: unknown = JSON.parse(await file.text());
      const source = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { profiles?: unknown }).profiles) ? (raw as { profiles: unknown[] }).profiles : null;
      if (!source || source.length < 1 || source.length > 100) throw new Error('El archivo debe contener entre 1 y 100 perfiles.');
      const knownTools = new Set(tools.map((tool) => tool.name));
      const normalized = source.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El archivo contiene un perfil inválido.');
        const item = value as Partial<AgentProfile>;
        if (typeof item.name !== 'string' || typeof item.instructions !== 'string' || !Array.isArray(item.toolAllowlist) || item.toolAllowlist.some((name) => typeof name !== 'string')) throw new Error('Cada perfil debe incluir nombre, instrucciones y una lista de herramientas.');
        const toolAllowlist = [...new Set(item.toolAllowlist as string[])];
        const unknownTools = toolAllowlist.filter((name) => !knownTools.has(name));
        if (unknownTools.length) throw new Error(`El archivo incluye herramientas desconocidas: ${unknownTools.join(', ')}`);
        return { name: item.name, description: typeof item.description === 'string' ? item.description : '', instructions: item.instructions, toolAllowlist, enabled: typeof item.enabled === 'boolean' ? item.enabled : true };
      });
      for (const profile of normalized) await saveCustomAgent(profile);
      await refresh();
      setNotice(`${normalized.length} agente${normalized.length === 1 ? '' : 's'} importado${normalized.length === 1 ? '' : 's'}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setTransferring(false); }
  };

  return <Localized><div className="surface-page agent-studio">
    <div className="surface-heading"><Bot size={18} /><div><h2>Agentes</h2><p>Configura especialistas propios. Cada uno hereda el modelo y los permisos de la conversación y puede limitar sus herramientas.</p></div><span className="panel-title-spacer" /><div className="agent-surface-actions"><button type="button" onClick={exportProfiles} disabled={!profiles.length || transferring}>Exportar</button><label className="agent-import-button">{transferring ? 'Importando…' : 'Importar'}<input type="file" accept="application/json,.json" onChange={(event) => void importProfiles(event)} disabled={!health?.harnessConnected || transferring} /></label><button type="button" className="surface-refresh" onClick={create} disabled={!health?.harnessConnected || busy || transferring}><Plus size={13} />Nuevo agente</button></div></div>
    {!health?.harnessConnected && <div className="surface-note">Conecta un workspace para administrar agentes persistentes. Los especialistas oficiales siguen disponibles en esta vista previa.</div>}
    <div className="agent-grid">{officialAgents.map((agent) => <button type="button" className={`agent-card ${agentId === agent.id ? 'is-active' : ''}`} key={agent.id} aria-pressed={agentId === agent.id} onClick={() => set('agentId', agent.id)}><span className="agent-mark"><Bot size={14} /></span><strong>{agent.name}</strong><small>{agent.detail}</small><span className="agent-card-tag">Oficial</span></button>)}
      {profiles.map((profile) => <article className={`agent-card agent-card--custom ${agentId === profile.id ? 'is-active' : ''} ${profile.enabled ? '' : 'is-disabled'}`} key={profile.id}><button type="button" className="agent-card-select" aria-pressed={agentId === profile.id} disabled={!profile.enabled} onClick={() => set('agentId', profile.id)}><span className="agent-mark"><Bot size={14} /></span><strong>{profile.name}</strong><small>{profile.description || 'Agente personalizado'}</small><span className="agent-card-tag">Personalizado · {profile.toolAllowlist.length} herramientas · {profile.enabled ? 'Activo' : 'Inactivo'}</span></button><span className="agent-card-actions"><button type="button" aria-label={`Editar ${profile.name}`} title="Editar" onClick={() => edit(profile)}><Pencil size={12} /></button><button type="button" aria-label={`Eliminar ${profile.name}`} title="Eliminar" onClick={() => void remove(profile)} disabled={busy}><Trash2 size={12} /></button></span></article>)}
    </div>
    {draft && <section className="agent-editor" aria-label="Editor de agente personalizado">
      <div className="agent-editor-header"><strong>{draft.id ? 'Editar agente' : 'Nuevo agente'}</strong><span className="panel-title-spacer" /><button type="button" className="agent-close" onClick={() => setDraft(null)} aria-label="Cerrar editor"><X size={14} /></button></div>
      <div className="agent-form-grid"><label>Nombre<input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej.: Documentación" /></label><label>Descripción<input value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="En qué ayuda este agente" /></label></div>
      <label className="agent-instructions">Instrucciones<textarea value={draft.instructions} maxLength={20_000} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="Describe su enfoque, límites y el tipo de resultado que debe entregar." /></label>
      <label className="agent-instructions">Solicitud de prueba<textarea value={testPrompt} maxLength={4_000} onChange={(event) => setTestPrompt(event.target.value)} /></label>
      <p className="agent-test-notice">La prueba usa el proveedor y modelo seleccionados en esta sesión. Puede generar costo. No ofrece herramientas al modelo ni ejecuta acciones.</p>
      {testResult && <div className="agent-test-result" role="status"><strong>Respuesta del modelo · {testResult.providerId} / {testResult.modelId}</strong><pre>{testResult.content || 'El modelo devolvió una respuesta vacía.'}</pre><small>{[testResult.inputTokens !== undefined ? `${testResult.inputTokens} tokens de entrada` : '', testResult.outputTokens !== undefined ? `${testResult.outputTokens} de salida` : '', `${testResult.durationMs} ms`, testResult.toolCallsIgnored ? 'Se ignoraron solicitudes de herramientas; no se ejecutaron.' : 'Sin herramientas ejecutadas.'].filter(Boolean).join(' · ')}</small></div>}
      <div className="agent-tool-heading"><div><strong>Herramientas permitidas</strong><small>Solo las seleccionadas se ofrecen al modelo; los permisos de sesión siguen aplicándose.</small></div><span>{draft.toolAllowlist.length} seleccionadas</span></div>
      <div className="agent-tool-list">{tools.map((tool) => <label className="agent-tool-choice" key={tool.name}><input type="checkbox" checked={draft.toolAllowlist.includes(tool.name)} onChange={(event) => setDraft({ ...draft, toolAllowlist: event.target.checked ? [...draft.toolAllowlist, tool.name] : draft.toolAllowlist.filter((name) => name !== tool.name) })} /><span><strong>{tool.name}</strong><small>{tool.description}</small></span><small>{tool.effects.join(' · ')}</small></label>)}</div>
      <label className="agent-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Agente activo</label>
      <div className="agent-editor-footer"><span className="panel-title-spacer" /><button type="button" className="agent-cancel" onClick={() => setDraft(null)}>Cancelar</button><button type="button" className="agent-test" disabled={testing || !session || !session.model || !session.providerId || !draft.enabled || !draft.name.trim() || !draft.instructions.trim() || !testPrompt.trim()} onClick={() => void test()}>{testing ? 'Probando…' : 'Probar con el modelo'}</button><button type="button" className="agent-save" disabled={busy || testing || !draft.name.trim() || !draft.instructions.trim()} onClick={() => void save()}><Save size={13} />{busy ? 'Guardando…' : 'Guardar agente'}</button></div>
    </section>}
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="surface-note" role="status"><Check size={13} />{notice}</p>}
    <p className="surface-note"><span>Seleccionado:</span> {officialAgents.find((agent) => agent.id === agentId)?.name ?? profiles.find((profile) => profile.id === agentId)?.name ?? 'General'}. <span>Los agentes personalizados no pueden cambiar de modelo ni ampliar el perfil de permisos de la sesión.</span></p>
  </div></Localized>;
}
